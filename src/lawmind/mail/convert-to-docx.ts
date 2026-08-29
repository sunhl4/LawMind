/**
 * Convert alternate Word-like attachments (wps/rtf/odt) or prepare an ephemeral
 * OpenXML working copy from binary `.doc` for tooling that only speaks OOXML.
 *
 * Converter preference (fidelity for fonts / layout / existing revisions):
 *   1. Microsoft Word via AppleScript (macOS) — preserves revisions/comments/styles
 *   2. LibreOffice `soffice` when available
 *   3. macOS `textutil` — **lossy** last resort (strips revisions & most formatting)
 *
 * Product rule: binary `.doc` is a first-class baseline for lawyers — callers must
 * not require them to convert. This helper is for engine-internal working copies.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
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
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk).slice(0, 4_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
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

async function convertWithSoffice(absIn: string, absOut: string): Promise<boolean> {
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
 * No-op when already .docx. For convertible formats, writes a sibling `.docx` when a tool works.
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
  if (kind === "tracked_word" && /\.docx$/i.test(rel)) {
    return { ok: true, relativePath: rel, converted: false, fidelity: "high" };
  }
  // Binary .doc and wps/rtf/odt may be materialized to .docx for OpenXML-only tools.
  const canMaterialize =
    kind === "convertible_word" || (kind === "tracked_word" && /\.doc$/i.test(rel));
  if (!canMaterialize) {
    return { ok: false, error: "not_convertible" };
  }

  const outRel = siblingDocxRelative(rel);
  const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
  if (!resolvedOut.ok) {
    return { ok: false, error: "path_escape" };
  }
  const absOut = resolvedOut.abs;

  // Prefer re-converting when an existing sibling was produced by lossy textutil
  // (small / no revisions). Callers that need a guaranteed high-fidelity copy should
  // pass a fresh temp dir (ephemeralDocxWorkingCopy) so this branch is skipped.
  if (fs.existsSync(absOut) && fs.statSync(absOut).size > 0) {
    return { ok: true, relativePath: outRel, converted: false, tool: "existing", fidelity: "high" };
  }

  // Misnamed OOXML: copy bytes to .docx
  if (looksLikeZipDocx(absIn)) {
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.copyFileSync(absIn, absOut);
    return { ok: true, relativePath: outRel, converted: true, tool: "zip-copy", fidelity: "high" };
  }

  fs.mkdirSync(path.dirname(absOut), { recursive: true });

  const isBinaryDoc = /\.doc$/i.test(rel) && !/\.docx$/i.test(rel);
  const wordInstalled = microsoftWordAppExists();

  // 1) Microsoft Word — required for preserving 国浩-style revisions/comments/fonts.
  // Retry once: first launch / automation permission prompts can flake.
  if (await convertWithMicrosoftWord(absIn, absOut)) {
    return { ok: true, relativePath: outRel, converted: true, tool: "msword", fidelity: "high" };
  }
  if (wordInstalled && (await convertWithMicrosoftWord(absIn, absOut))) {
    return { ok: true, relativePath: outRel, converted: true, tool: "msword", fidelity: "high" };
  }
  // 2) LibreOffice
  if (await convertWithSoffice(absIn, absOut)) {
    return { ok: true, relativePath: outRel, converted: true, tool: "soffice", fidelity: "high" };
  }
  // 3) textutil — strips revisions & formatting. Never use for binary .doc when Word is
  // installed (that path previously shipped unreadable shells that looked "successful").
  if (!(isBinaryDoc && wordInstalled) && (await convertWithTextutil(absIn, absOut))) {
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
  if (isBinaryDoc && wordInstalled) {
    return {
      ok: false,
      error:
        "convert_failed（已检测到 Microsoft Word，但高保真 .doc→.docx 失败；请在「系统设置 → 隐私与安全性 → 自动化」允许 LawMind/终端控制 Word 后重试。不会使用 textutil 有损转写，以免丢失原字体与审阅修订）",
    };
  }
  return {
    ok: false,
    error:
      process.platform === "darwin"
        ? "convert_failed（本机 Microsoft Word / LibreOffice / textutil 均未能生成审阅工作副本；无需律师先转格式）"
        : "convert_failed（本机缺少 LibreOffice/soffice，无法生成审阅工作副本；无需律师先转格式）",
  };
}
