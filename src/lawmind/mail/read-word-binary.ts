/**
 * Native text extraction for binary Word (.doc) and similar — no format conversion.
 * Prefers macOS `textutil -convert txt -stdout`; falls back to LibreOffice txt export to a temp file.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function runCapture(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on("data", (c: Buffer | string) => {
      if (stdout.length < 2_000_000) {
        stdout += String(c);
      }
    });
    child.stderr?.on("data", (c: Buffer | string) => {
      if (stderr.length < 4_000) {
        stderr += String(c);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout: "", stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
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
