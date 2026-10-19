/**
 * Export a .docx to a sibling .pdf via LibreOffice/soffice (high-fidelity print).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { RESOURCE_LEASE_SOFFICE, withResourceLease } from "../runtime/turn-admission.js";

export type ExportDocxPdfResult =
  | { ok: true; outAbs: string; outFileName: string; tool: "soffice" }
  | { ok: false; error: string };

function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ code: number | null }> {
  return runSafeCommand({
    command,
    args,
    env: buildMinimalChildEnv(),
    timeoutMs: opts.timeoutMs ?? 120_000,
    signal: opts.signal,
    killSignal: "SIGKILL",
    stdio: ["ignore", "ignore", "pipe"],
    maxStderrBytes: 4_000,
  })
    .then((result) => ({ code: result.exitCode }))
    .catch(() => ({ code: 127 }));
}

/** Convert `baseAbs` (.docx) to a sibling `*.pdf` next to it. */
export async function exportDocxToPdf(
  baseAbs: string,
  opts?: { signal?: AbortSignal },
): Promise<ExportDocxPdfResult> {
  return withResourceLease(RESOURCE_LEASE_SOFFICE, () =>
    exportDocxToPdfUnleased(baseAbs, opts?.signal),
  );
}

async function exportDocxToPdfUnleased(
  baseAbs: string,
  signal?: AbortSignal,
): Promise<ExportDocxPdfResult> {
  if (!/\.docx$/i.test(baseAbs)) {
    return { ok: false, error: "只能从 .docx 导出 PDF。" };
  }
  if (!fs.existsSync(baseAbs) || !fs.statSync(baseAbs).isFile()) {
    return { ok: false, error: "找不到这份 Word。" };
  }
  const outFileName = path.basename(baseAbs).replace(/\.docx$/i, ".pdf");
  const outAbs = path.join(path.dirname(baseAbs), outFileName);
  const candidates = [
    "soffice",
    "libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];
  for (const bin of candidates) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pdf-"));
    try {
      const r = await runCommand(
        bin,
        [
          "--headless",
          "--nologo",
          "--nolockcheck",
          "--convert-to",
          "pdf",
          "--outdir",
          tmpDir,
          baseAbs,
        ],
        { signal },
      );
      if (r.code !== 0) {
        continue;
      }
      const produced = fs.readdirSync(tmpDir).find((n) => n.toLowerCase().endsWith(".pdf"));
      if (!produced) {
        continue;
      }
      fs.copyFileSync(path.join(tmpDir, produced), outAbs);
      if (fs.existsSync(outAbs) && fs.statSync(outAbs).size > 0) {
        return { ok: true, outAbs, outFileName, tool: "soffice" };
      }
    } catch {
      /* try next binary */
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  return {
    ok: false,
    error:
      process.platform === "darwin"
        ? "本机未能导出 PDF。请安装 LibreOffice，或用 Word/WPS 另存为 PDF。"
        : "本机缺少 LibreOffice/soffice，无法导出 PDF。",
  };
}
