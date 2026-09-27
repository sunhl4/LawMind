/**
 * Native text extraction for binary Word (.doc) and similar — no format conversion.
 * Prefers macOS `textutil -convert txt -stdout`; falls back to LibreOffice txt export to a temp file.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { ensureLocalFileSync } from "../runtime/icloud-materialize.js";

const TEXT_EXTRACT_MAX_STDOUT = 2_000_000;
const TEXT_EXTRACT_MAX_STDERR = 4_000;

async function runCapture(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  try {
    const result = await runSafeCommand({
      command,
      args,
      env: buildMinimalChildEnv(),
      timeoutMs,
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "pipe"],
      maxStdoutBytes: TEXT_EXTRACT_MAX_STDOUT,
      maxStderrBytes: TEXT_EXTRACT_MAX_STDERR,
    });
    return {
      code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    return {
      code: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractViaTextutil(absPath: string): Promise<string | null> {
  if (process.platform !== "darwin") {
    return null;
  }
  const r = await runCapture("textutil", ["-convert", "txt", "-stdout", absPath]);
  if (r.code !== 0) {
    return null;
  }
  const text = normalizeText(r.stdout);
  return text || null;
}

async function extractViaSoffice(absPath: string): Promise<string | null> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-doc-txt-"));
  try {
    for (const bin of ["soffice", "libreoffice"]) {
      const r = await runCapture(
        bin,
        [
          "--headless",
          "--nologo",
          "--nolockcheck",
          "--convert-to",
          "txt:Text",
          "--outdir",
          tmpDir,
          absPath,
        ],
        { timeoutMs: 90_000 },
      );
      if (r.code !== 0) {
        continue;
      }
      const produced = fs.readdirSync(tmpDir).find((n) => n.toLowerCase().endsWith(".txt"));
      if (!produced) {
        continue;
      }
      const text = normalizeText(fs.readFileSync(path.join(tmpDir, produced), "utf8"));
      if (text) {
        return text;
      }
    }
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** True for binary Word 97–2003 `.doc` (not `.docx`). */
export function isBinaryWordDocPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".doc";
}

/**
 * Extract plain text from a binary `.doc` without writing a converted `.docx` beside it.
 */
export async function readBinaryWordDocText(absPath: string): Promise<string> {
  // textutil / soffice 自己会 read()。先落地，避免子进程堵在 iCloud 占位上。
  ensureLocalFileSync(absPath);
  const viaTextutil = await extractViaTextutil(absPath);
  if (viaTextutil) {
    return viaTextutil;
  }
  const viaSoffice = await extractViaSoffice(absPath);
  if (viaSoffice) {
    return viaSoffice;
  }
  throw new Error(
    process.platform === "darwin"
      ? "无法直接读取 .doc 正文（textutil/LibreOffice 均失败）"
      : "无法直接读取 .doc 正文（请安装 LibreOffice/soffice）",
  );
}
