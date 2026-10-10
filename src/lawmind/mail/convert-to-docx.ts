/**
 * Convert alternate Word-like attachments (wps/rtf/odt) for OpenXML tooling.
 *
 * Binary `.doc` is not auto-converted for revision. Lawyers save as `.docx` in
 * Word or WPS. Misnamed OOXML (zip bytes with a `.doc` name) is copied as-is.
 *
 * Converter preference for wps/rtf/odt:
 *   1. Microsoft Word via AppleScript (macOS)
 *   2. LibreOffice `soffice` when available
 *   3. macOS `textutil` — **lossy** last resort
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
import { DOC_NEEDS_DOCX_MESSAGE } from "./doc-revision-gate.js";
import { classifyContractAttachment } from "./mail-contract-formats.js";

export type ConvertToDocxTool = "msword" | "soffice" | "textutil" | "zip-copy" | "existing";

export type ConvertToDocxResult =
  | {
      ok: true;
      relativePath: string;
      converted: boolean;
      tool?: ConvertToDocxTool;
      /**
       * `lossy` when textutil (or similar) produced a shell that drops original
       * revisions/fonts — callers must warn and must not claim format fidelity.
       */
      fidelity?: "high" | "lossy";
    }
  | { ok: false; error: string };

type DocxCacheMeta = {
  tool: ConvertToDocxTool;
  fidelity: "high";
  sourceSize: number;
  sourceMtimeMs: number;
  createdAt: string;
};

function docOoxmlCachePaths(absIn: string): { docx: string; meta: string } {
  const st = fs.statSync(absIn);
  const hash = createHash("sha256")
    .update(absIn)
    .update(String(st.size))
    .update(String(Math.trunc(st.mtimeMs)))
    .digest("hex")
    .slice(0, 24);
  const root = path.join(os.homedir(), "Library", "Caches", "LawMind", "doc-ooxml");
  return {
    docx: path.join(root, `${hash}.docx`),
    meta: path.join(root, `${hash}.json`),
  };
}

/** Reuse a prior high-fidelity .doc→.docx conversion (avoids re-launching Word). */
export function tryReadHighFidelityDocxCache(
  absDocPath: string,
): { docxPath: string; tool: ConvertToDocxTool } | null {
  try {
    const st = fs.statSync(absDocPath);
    const { docx, meta } = docOoxmlCachePaths(absDocPath);
    if (!fs.existsSync(docx) || !fs.existsSync(meta)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(meta, "utf8")) as DocxCacheMeta;
    if (
      parsed.sourceSize !== st.size ||
      parsed.sourceMtimeMs !== Math.trunc(st.mtimeMs) ||
      parsed.fidelity !== "high" ||
      !looksLikeZipDocx(docx) ||
      fs.statSync(docx).size < 1_000
    ) {
      return null;
    }
    return { docxPath: docx, tool: parsed.tool };
  } catch {
    return null;
  }
}

export function writeHighFidelityDocxCache(
  absDocPath: string,
  absDocx: string,
  tool: ConvertToDocxTool,
): void {
  if (tool === "textutil" || tool === "existing") {
    return;
  }
  try {
    const st = fs.statSync(absDocPath);
    const { docx, meta } = docOoxmlCachePaths(absDocPath);
    fs.mkdirSync(path.dirname(docx), { recursive: true });
    fs.copyFileSync(absDocx, docx);
    const payload: DocxCacheMeta = {
      tool,
      fidelity: "high",
      sourceSize: st.size,
      sourceMtimeMs: Math.trunc(st.mtimeMs),
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(meta, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* cache is best-effort */
  }
}

function runCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number | null; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return runSafeCommand({
    command,
    args,
    cwd: opts.cwd,
    env: buildMinimalChildEnv(),
    timeoutMs,
    killSignal: "SIGKILL",
    stdio: ["ignore", "ignore", "pipe"],
    maxStderrBytes: 4_000,
  })
    .then((result) => ({
      code: result.exitCode,
      stderr: result.stderr,
    }))
    .catch((err) => ({
      code: 127,
      stderr: err instanceof Error ? err.message : String(err),
    }));
}

function looksLikeZipDocx(abs: string): boolean {
  try {
    const fd = fs.openSync(abs, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x50 && buf[1] === 0x4b; // PK
  } catch {
    return false;
  }
}

function siblingDocxRelative(relativePath: string): string {
  const posix = relativePath.replace(/\\/g, "/");
  const dir = path.posix.dirname(posix);
  const base = path.posix.basename(posix);
  const stem = base.replace(/\.[^.]+$/i, "");
  const outName = `${stem}.docx`;
  return dir === "." ? outName : path.posix.join(dir, outName);
}

/** Preview-only sibling: `合同.doc` → `合同.converted.docx` (never overwrites a peer `.docx`). */
export function siblingConvertedDocxRelative(relativePath: string): string {
  const posix = relativePath.replace(/\\/g, "/");
  const dir = path.posix.dirname(posix);
  const base = path.posix.basename(posix);
  const stem = base.replace(/\.[^.]+$/i, "");
  const outName = `${stem}.converted.docx`;
  return dir === "." ? outName : path.posix.join(dir, outName);
}

function microsoftWordAppExists(): boolean {
  return (
    fs.existsSync("/Applications/Microsoft Word.app") ||
    fs.existsSync(`${os.homedir()}/Applications/Microsoft Word.app`)
  );
}

/**
 * High-fidelity .doc → .docx via Microsoft Word (macOS).
 * Preserves track-changes, comments, styles, headers/footers far better than textutil.
 * Save may succeed even when AppleScript `close` returns a benign -1728.
 */
export async function convertWithMicrosoftWord(absIn: string, absOut: string): Promise<boolean> {
  if (process.platform !== "darwin" || !microsoftWordAppExists()) {
    return false;
  }
  const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-msword-"));
  const scriptPath = path.join(scriptDir, "convert.applescript");
  // Embed paths as AppleScript string literals (escape backslash + quote).
  const q = (p: string) => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const script = [
    `set inPath to POSIX file ${q(absIn)}`,
    `set outPath to POSIX file ${q(absOut)}`,
    `tell application "Microsoft Word"`,
    `  set theDoc to open file name inPath with read only without confirm conversions`,
    `  save as theDoc file name outPath file format format document`,
    `  try`,
    `    close theDoc saving no`,
    `  end try`,
    `end tell`,
    "",
  ].join("\n");
  try {
    fs.writeFileSync(scriptPath, script, "utf8");
    // Word UI automation can be slow on first launch.
    await runCommand("osascript", [scriptPath], { timeoutMs: 180_000 });
    return fs.existsSync(absOut) && looksLikeZipDocx(absOut) && fs.statSync(absOut).size > 1_000;
  } finally {
    try {
      fs.rmSync(scriptDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    // Word lock sidecar
    try {
      const lock = path.join(path.dirname(absOut), `~$${path.basename(absOut)}`);
      if (fs.existsSync(lock)) {
        fs.unlinkSync(lock);
      }
    } catch {
      /* ignore */
    }
  }
}

async function convertWithTextutil(absIn: string, absOut: string): Promise<boolean> {
  if (process.platform !== "darwin") {
    return false;
  }
  const r = await runCommand("textutil", ["-convert", "docx", "-output", absOut, absIn]);
  return r.code === 0 && fs.existsSync(absOut) && fs.statSync(absOut).size > 0;
}

export async function convertWithSoffice(absIn: string, absOut: string): Promise<boolean> {
  const outDir = path.dirname(absOut);
  const candidates = [
    "soffice",
    "libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const bin of candidates) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-soffice-"));
    try {
      const r = await runCommand(
        bin,
        [
          "--headless",
          "--nologo",
          "--nolockcheck",
          "--convert-to",
          "docx",
          "--outdir",
          tmpDir,
          absIn,
        ],
        { timeoutMs: 90_000 },
      );
      if (r.code !== 0) {
        continue;
      }
      const produced = fs.readdirSync(tmpDir).find((n) => n.toLowerCase().endsWith(".docx"));
      if (!produced) {
        continue;
      }
      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(path.join(tmpDir, produced), absOut);
      if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) {
        return true;
      }
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

/**
 * Ensure a workspace-relative attachment has a .docx form suitable for tracked redlines.
 * No-op when already .docx. Binary `.doc` is not converted — lawyer saves as `.docx`.
 * Misnamed OOXML and wps/rtf/odt may still materialize a sibling `.docx`.
 */
export async function ensureDocxForAttachment(
  workspaceDir: string,
  relativePath: string,
): Promise<ConvertToDocxResult> {
  const resolvedIn = resolveWorkspaceRelativePath(workspaceDir, relativePath);
  if (!resolvedIn.ok) {
    return { ok: false, error: resolvedIn.error === "empty" ? "invalid_path" : "path_escape" };
  }
  const rel = resolvedIn.rel;
  const absIn = resolvedIn.abs;
  if (!fs.existsSync(absIn) || !fs.statSync(absIn).isFile()) {
    return { ok: false, error: "missing_file" };
  }

  const kind = classifyContractAttachment(rel);
  if (kind === "tracked_word") {
    return { ok: true, relativePath: rel, converted: false, fidelity: "high" };
  }

  const isLegacyDoc = kind === "legacy_doc" || (/\.doc$/i.test(rel) && !/\.docx$/i.test(rel));
  // Misnamed OOXML: copy bytes to .docx
  if (isLegacyDoc && looksLikeZipDocx(absIn)) {
    const outRel = siblingDocxRelative(rel);
    const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
    if (!resolvedOut.ok) {
      return { ok: false, error: "path_escape" };
    }
    fs.mkdirSync(path.dirname(resolvedOut.abs), { recursive: true });
    fs.copyFileSync(absIn, resolvedOut.abs);
    return { ok: true, relativePath: outRel, converted: true, tool: "zip-copy", fidelity: "high" };
  }
  if (isLegacyDoc) {
    return { ok: false, error: DOC_NEEDS_DOCX_MESSAGE };
  }

  if (kind !== "convertible_word") {
    return { ok: false, error: "not_convertible" };
  }

  const outRel = siblingDocxRelative(rel);
  const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
  if (!resolvedOut.ok) {
    return { ok: false, error: "path_escape" };
  }
  const absOut = resolvedOut.abs;

  if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) {
    return { ok: true, relativePath: outRel, converted: false, tool: "existing", fidelity: "high" };
  }

  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const wordInstalled = microsoftWordAppExists();
  if (await convertWithMicrosoftWord(absIn, absOut)) {
    return { ok: true, relativePath: outRel, converted: true, tool: "msword", fidelity: "high" };
  }
  if (wordInstalled && (await convertWithMicrosoftWord(absIn, absOut))) {
    return { ok: true, relativePath: outRel, converted: true, tool: "msword", fidelity: "high" };
  }
  if (await convertWithSoffice(absIn, absOut)) {
    return { ok: true, relativePath: outRel, converted: true, tool: "soffice", fidelity: "high" };
  }
  if (await convertWithTextutil(absIn, absOut)) {
    return {
      ok: true,
      relativePath: outRel,
      converted: true,
      tool: "textutil",
      fidelity: "lossy",
    };
  }
  try {
    if (fs.existsSync(absOut)) {
      fs.unlinkSync(absOut);
    }
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    error:
      process.platform === "darwin"
        ? "convert_failed（本机 Microsoft Word / LibreOffice / textutil 均未能生成审阅工作副本）"
        : "convert_failed（本机缺少 LibreOffice/soffice，无法生成审阅工作副本）",
  };
}

/**
 * Middle-column preview: convert binary `.doc` to a sibling `*.converted.docx`
 * after the lawyer confirms. Prefer Word / LibreOffice; never use textutil here
 * (lossy shells are not a safe preview stand-in for contract revision).
 */
export async function convertLegacyDocForPreview(
  workspaceDir: string,
  relativePath: string,
): Promise<ConvertToDocxResult> {
  const resolvedIn = resolveWorkspaceRelativePath(workspaceDir, relativePath);
  if (!resolvedIn.ok) {
    return { ok: false, error: resolvedIn.error === "empty" ? "invalid_path" : "path_escape" };
  }
  const rel = resolvedIn.rel;
  const absIn = resolvedIn.abs;
  if (!fs.existsSync(absIn) || !fs.statSync(absIn).isFile()) {
    return { ok: false, error: "missing_file" };
  }
  if (!/\.doc$/i.test(rel) || /\.docx$/i.test(rel)) {
    return { ok: false, error: "not_legacy_doc" };
  }

  if (looksLikeZipDocx(absIn)) {
    const outRel = siblingConvertedDocxRelative(rel);
    const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
    if (!resolvedOut.ok) {
      return { ok: false, error: "path_escape" };
    }
    fs.mkdirSync(path.dirname(resolvedOut.abs), { recursive: true });
    fs.copyFileSync(absIn, resolvedOut.abs);
    return { ok: true, relativePath: outRel, converted: true, tool: "zip-copy", fidelity: "high" };
  }

  const outRel = siblingConvertedDocxRelative(rel);
  const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
  if (!resolvedOut.ok) {
    return { ok: false, error: "path_escape" };
  }
  const absOut = resolvedOut.abs;
  if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0 && looksLikeZipDocx(absOut)) {
    return { ok: true, relativePath: outRel, converted: false, tool: "existing", fidelity: "high" };
  }
  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  if (await convertWithMicrosoftWord(absIn, absOut)) {
    writeHighFidelityDocxCache(absIn, absOut, "msword");
    return { ok: true, relativePath: outRel, converted: true, tool: "msword", fidelity: "high" };
  }
  if (await convertWithSoffice(absIn, absOut)) {
    writeHighFidelityDocxCache(absIn, absOut, "soffice");
    return { ok: true, relativePath: outRel, converted: true, tool: "soffice", fidelity: "high" };
  }
  try {
    if (fs.existsSync(absOut)) {
      fs.unlinkSync(absOut);
    }
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    error:
      process.platform === "darwin"
        ? "本机未能把这份 .doc 转成 .docx。请安装 LibreOffice，或用 Word/WPS 另存为 .docx 后再打开。"
        : "本机缺少 LibreOffice/soffice，无法把这份 .doc 转成预览用的 .docx。",
  };
}
