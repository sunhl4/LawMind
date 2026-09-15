import katex from "katex";
import { tryConsumeLmSessionMarkdown } from "./lawmind-session-link";

export type InlineMarkdownToken =
  | { kind: "text"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "code"; value: string }
  | { kind: "math"; tex: string; display: boolean }
  | { kind: "session_link"; label: string; sessionId: string; assistantId?: string };

const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "ignore" as const,
  output: "htmlAndMathml" as const,
  errorColor: "#b45309",
};

export function renderKatexHtml(tex: string, display: boolean): string | null {
  const source = tex.trim();
  if (!source) {
    return null;
  }
  try {
    return katex.renderToString(source, { ...KATEX_OPTIONS, displayMode: display });
  } catch {
    return null;
  }
}

export function tryConsumeDisplayMath(
  lines: string[],
  index: number,
): { tex: string; next: number } | null {
  const trimmed = (lines[index] ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const sameDollar = /^\$\$([\s\S]+?)\$\$$/.exec(trimmed);
  if (sameDollar && !trimmed.slice(2, -2).includes("$$")) {
    const tex = sameDollar[1].trim();
    return tex ? { tex, next: index + 1 } : null;
  }

  const sameBracket = /^\\\[([\s\S]+?)\\\]$/.exec(trimmed);
  if (sameBracket) {
    const tex = sameBracket[1].trim();
    return tex ? { tex, next: index + 1 } : null;
  }

  if (trimmed === "$$" || trimmed === "\\[") {
    const close = trimmed === "$$" ? "$$" : "\\]";
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if ((lines[cursor] ?? "").trim() === close) {
        const tex = body.join("\n").trim();
        return tex ? { tex, next: cursor + 1 } : null;
      }
      body.push(lines[cursor] ?? "");
    }
  }

  return null;
}

/**
 * Codex conversation + VS Code preview delimiters:
 * `\(...\)`, `\[...\]`, `$$...$$`, and GitHub-style `$...$`.
 * Code spans win. `\$` is a literal dollar. Currency like `$100` stays text.
 */
export function tokenizeInlineLegalMarkdown(text: string): InlineMarkdownToken[] {
  const tokens: InlineMarkdownToken[] = [];
  let buffer = "";
  let index = 0;

  const flush = (): void => {
    if (buffer) {
      tokens.push({ kind: "text", value: buffer });
      buffer = "";
    }
  };

  while (index < text.length) {
    if (text.startsWith("\\$", index)) {
      buffer += "$";
      index += 2;
      continue;
    }

    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        flush();
        tokens.push({ kind: "code", value: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith("$$", index)) {
      const end = text.indexOf("$$", index + 2);
      if (end !== -1) {
        const tex = text.slice(index + 2, end);
        if (tex.trim()) {
          flush();
          tokens.push({ kind: "math", tex, display: true });
          index = end + 2;
          continue;
        }
      }
    }

    if (text.startsWith("\\(", index)) {
      const end = text.indexOf("\\)", index + 2);
      if (end !== -1) {
        flush();
        tokens.push({ kind: "math", tex: text.slice(index + 2, end), display: false });
        index = end + 2;
        continue;
      }
    }

    if (text.startsWith("\\[", index)) {
      const end = text.indexOf("\\]", index + 2);
      if (end !== -1) {
        flush();
        tokens.push({ kind: "math", tex: text.slice(index + 2, end), display: true });
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "$" && text[index + 1] !== "$") {
      const dollar = trySingleDollarMath(text, index);
      if (dollar) {
        flush();
        tokens.push(dollar.token);
        index = dollar.next;
        continue;
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        tokens.push({ kind: "bold", value: text.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "[") {
      const sessionLink = tryConsumeLmSessionMarkdown(text, index);
      if (sessionLink) {
        flush();
        tokens.push({
          kind: "session_link",
          label: sessionLink.link.label,
          sessionId: sessionLink.link.sessionId,
          ...(sessionLink.link.assistantId
            ? { assistantId: sessionLink.link.assistantId }
            : {}),
        });
        index = sessionLink.next;
        continue;
      }
    }

    buffer += text[index];
    index += 1;
  }

  flush();
  return tokens;
}

function trySingleDollarMath(
  text: string,
  start: number,
): { token: InlineMarkdownToken; next: number } | null {
  if (start + 1 >= text.length) {
    return null;
  }
  const nextChar = text[start + 1] ?? "";
  if (/\s/.test(nextChar)) {
    return null;
  }
  const prev = start > 0 ? (text[start - 1] ?? "") : "";
  if (/[A-Za-z0-9]/.test(prev)) {
    return null;
  }

  let cursor = start + 1;
  while (cursor < text.length) {
    const ch = text[cursor] ?? "";
    if (ch === "\n") {
      return null;
    }
    if (ch === "\\" && cursor + 1 < text.length) {
      cursor += 2;
      continue;
    }
    if (ch === "$") {
      const before = text[cursor - 1] ?? "";
      const after = text[cursor + 1] ?? "";
      if (/\s/.test(before)) {
        return null;
      }
      if (/[0-9]/.test(after)) {
        cursor += 1;
        continue;
      }
      const tex = text.slice(start + 1, cursor);
      if (!tex.trim()) {
        return null;
      }
      return { token: { kind: "math", tex, display: false }, next: cursor + 1 };
    }
    cursor += 1;
  }
  return null;
}
