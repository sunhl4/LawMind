import { transform } from "sucrase";

const DENIED: Array<[RegExp, string]> = [
  [/import\s*\(/, "画布不能动态 import。"],
  [/\beval\s*\(/, "画布不能 eval。"],
  [/\bnew\s+Function\b/, "画布不能 new Function。"],
  [/\bfetch\s*\(/, "画布不能访问网络。"],
  [/\bXMLHttpRequest\b/, "画布不能访问网络。"],
  [/\bWebSocket\b/, "画布不能访问网络。"],
  [/\blocalStorage\b/, "画布状态请用 useCanvasState。"],
  [/\bdocument\s*\./, "画布不能直接操作 document。"],
  [/\bwindow\s*\./, "画布不能直接操作 window。"],
  [/\bprocess\s*\./, "画布不能碰 process。"],
  [/\brequire\s*\(/, "画布不能 require。"],
  [/<\/script/i, "画布源码不能包含 script 结束标记。"],
];

const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g;

export type CanvasDiagnostic = {
  line: number;
  column: number;
  message: string;
};

export type CanvasCompileResult =
  | { ok: true; script: string }
  | { ok: false; error: string; diagnostics: CanvasDiagnostic[] };

/** Value exports a canvas may import from `cursor/canvas`. Types are omitted. */
const CANVAS_RUNTIME_NAMES = new Set([
  "BarChart",
  "Button",
  "Callout",
  "Card",
  "CardBody",
  "CardHeader",
  "Checkbox",
  "Code",
  "CollapsibleSection",
  "DiffStats",
  "DiffView",
  "Divider",
  "Grid",
  "H1",
  "H2",
  "H3",
  "IconButton",
  "LineChart",
  "Link",
  "PieChart",
  "Pill",
  "Row",
  "Select",
  "Spacer",
  "Stack",
  "Stat",
  "Swatch",
  "Table",
  "Text",
  "TextArea",
  "TextInput",
  "TodoList",
  "TodoListCard",
  "Toggle",
  "UsageBar",
  "buildHostTokens",
  "canvasPaletteDark",
  "canvasPaletteLight",
  "canvasTokens",
  "canvasTokensDark",
  "canvasTokensFor",
  "canvasTokensLight",
  "categoryPaletteDark",
  "categoryPaletteLight",
  "colorPalette",
  "computeDAGLayout",
  "mergeStyle",
  "usageColorSequence",
  "useCanvasAction",
  "useCanvasState",
  "useEffect",
  "useHostTheme",
  "useMemo",
  "useRef",
  "useState",
]);

function lineColAt(source: string, index: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const stop = Math.min(index, source.length);
  for (let i = 0; i < stop; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function fail(message: string, at: { line: number; column: number }): CanvasCompileResult {
  const diagnostic = { ...at, message };
  return {
    ok: false,
    error: `${diagnostic.line}:${diagnostic.column} ${message}`,
    diagnostics: [diagnostic],
  };
}

function localNames(clause: string): Array<{ imported: string; local: string }> | string {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{")) {
    return "只能从 cursor/canvas 做具名导入。";
  }
  const body = trimmed.slice(1, trimmed.lastIndexOf("}"));
  const names: Array<{ imported: string; local: string }> = [];
  for (const part of body.split(",")) {
    const item = part.trim();
    if (!item || item.startsWith("type ")) {
      continue;
    }
    const alias = item.match(/^(\w+)\s+as\s+(\w+)$/);
    if (alias) {
      names.push({ imported: alias[1], local: alias[2] });
      continue;
    }
    if (/^\w+$/.test(item)) {
      names.push({ imported: item, local: item });
      continue;
    }
    return `无法识别的导入「${item}」。`;
  }
  return names;
}

/** Turn a saved `.canvas.tsx` into a classic script that mounts on `LawmindCanvas`. */
export function compileCanvasSource(source: string): CanvasCompileResult {
  for (const [pattern, message] of DENIED) {
    const found = pattern.exec(source);
    pattern.lastIndex = 0;
    if (found) {
      return fail(message, lineColAt(source, found.index));
    }
  }
  const names = new Set<string>();
  let body = source;
  const imports = [...source.matchAll(IMPORT_RE)];
  if (imports.length === 0) {
    return fail("画布需要从 cursor/canvas 导入组件。", { line: 1, column: 1 });
  }
  for (const match of imports) {
    const at = lineColAt(source, match.index ?? 0);
    const specifier = match[3];
    if (specifier !== "cursor/canvas") {
      return fail(`画布只能导入 cursor/canvas，不能导入 ${specifier}。`, at);
    }
    if (!match[1]) {
      const parsed = localNames(match[2] ?? "");
      if (typeof parsed === "string") {
        return fail(parsed, at);
      }
      for (const name of parsed) {
        if (!CANVAS_RUNTIME_NAMES.has(name.imported)) {
          return fail(`cursor/canvas 没有导出 ${name.imported}。`, at);
        }
        names.add(name.local);
      }
    }
    body = body.replace(match[0], "");
  }
  if (/\bimport\s/.test(body)) {
    return fail("还有不能用的 import。", { line: 1, column: 1 });
  }
  const declared = new Set(names);
  for (const match of source.matchAll(/(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9]*)\b/g)) {
    if (match[1]) {
      declared.add(match[1]);
    }
  }
  const tagRe = /(?:^|[^A-Za-z0-9_$.])<([A-Z][A-Za-z0-9]*)\b/g;
  for (;;) {
    const tag = tagRe.exec(source);
    if (!tag?.[1] || tag.index === undefined) {
      break;
    }
    if (!declared.has(tag[1])) {
      return fail(`画布里用了没有导入的组件 ${tag[1]}。`, lineColAt(source, tag.index + tag[0].lastIndexOf(tag[1])));
    }
  }
  const defaults = body.match(/export\s+default\b/g) ?? [];
  if (defaults.length !== 1) {
    return fail("画布需要恰好一个 export default。", { line: 1, column: 1 });
  }
  body = body.replace(/export\s+default\b/, "const __canvasDefault =");
  let compiled: string;
  try {
    compiled = transform(body, {
      transforms: ["typescript", "jsx"],
      jsxPragma: "LawmindCanvas.jsx",
      jsxFragmentPragma: "LawmindCanvas.Fragment",
      production: true,
    }).code;
  } catch (error) {
    const message = error instanceof Error ? error.message : "画布语法无法编译。";
    const located = error as { line?: number; column?: number };
    const fromMessage = message.match(/\((\d+):(\d+)\)/);
    return fail(message, {
      line: located.line ?? (fromMessage ? Number(fromMessage[1]) : 1),
      column: located.column ?? (fromMessage ? Number(fromMessage[2]) : 1),
    });
  }
  const binding = names.size > 0 ? `const { ${[...names].join(", ")} } = LawmindCanvas;\n` : "";
  const script = `(function(){\n${binding}${compiled}\nLawmindCanvas.mount(__canvasDefault);\n})();`;
  return { ok: true, script };
}

export function canvasFileStateKey(root: string, path: string): string {
  return `lawmind.canvas.file.${root}:${path}`;
}

function canvasSibling(canvasPath: string, extension: string): string | null {
  if (!/\.canvas\.tsx$/i.test(canvasPath) || canvasPath.split(/[/\\]/).includes("..")) {
    return null;
  }
  return canvasPath.replace(/\.canvas\.tsx$/i, extension);
}

/** `brief.canvas.tsx` → `brief.canvas.data.json`, beside the source. */
export function canvasDataPath(canvasPath: string): string | null {
  return canvasSibling(canvasPath, ".canvas.data.json");
}

/** `brief.canvas.tsx` → `brief.canvas.html`, a self-contained page beside the source. */
export function canvasHtmlPath(canvasPath: string): string | null {
  return canvasSibling(canvasPath, ".canvas.html");
}
