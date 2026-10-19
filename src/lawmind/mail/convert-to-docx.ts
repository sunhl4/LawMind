/**
 * Legacy `.doc` handling.
 *
 * Two different jobs, deliberately kept apart:
 *   - **Read** (preview / analyze / index): `read-word-binary.ts` parses the OLE
 *     container in-process. Fast, no dependency, no permission prompt.
 *   - **Convert** (produce a faithful `.docx`): the lawyer's own Microsoft Word
 *     does Save As. On macOS the file is staged inside Word's container so the
 *     sandbox file-access dialog never appears. LibreOffice headless is only a
 *     fallback when Word is not installed; it is not something we ask lawyers to
 *     install.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { RESOURCE_LEASE_SOFFICE, withResourceLease } from "../runtime/turn-admission.js";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
import { convertDocToDocxWithWord, microsoftWordInstalled } from "./convert-with-word.js";
import { DOC_NEEDS_DOCX_MESSAGE } from "./doc-revision-gate.js";
import { classifyContractAttachment } from "./mail-contract-formats.js";
import { readBinaryWordDocText } from "./read-word-binary.js";

/**
 * `.doc` → `.docx`：Word 优先（律师机器上一般都有，等于真正的另存为），
 * LibreOffice headless 兜底。两者都不可用时显式失败，绝不交正文替身。
 */
export type ConvertToDocxTool = "msword" | "soffice" | "zip-copy" | "existing";

export type ConvertToDocxResult =
  | {
      ok: true;
      relativePath: string;
      converted: boolean;
      tool?: ConvertToDocxTool;
      /** `high` = 排版引擎转换；`text-only` = 仅正文，调用方必须显式提示。 */
      fidelity?: "high" | "text-only";
    }
  | { ok: false; error: string };

/** 本机没有 Word（LibreOffice 也没装）时的律师话术。不静默降级、不假装成功。 */
export const CONVERTER_NEEDED_MESSAGE =
  "这份 .doc 要转成保留页眉页脚、表格、图片和已有修订的 .docx，需要本机的 Microsoft Word。请安装 Word 后重试，或在 Word 里将这份 .doc 另存为 .docx。";

/** Word 在，但另存没做成（修复框、密码、损坏）。不要再叫律师去装别的软件。 */
export const WORD_CONVERT_FAILED_MESSAGE =
  "本机 Word 没能把这份 .doc 另存为 .docx。常见原因是文件需要密码，或 Word 认为文件损坏、必须人工确认修复。请在 Word 里打开这份文件，另存为 .docx 后再交给 LawMind。";

/** @deprecated 旧的 LibreOffice 专用文案，保留给已有调用方。 */
export const SOFFICE_NEEDED_MESSAGE = CONVERTER_NEEDED_MESSAGE;

const SOFFICE_CANDIDATES = [
  "soffice",
  "libreoffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
];

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

/** 不只看退出码：包必须是合法 ZIP，且确实含 `word/document.xml`。 */
async function isValidDocxPackage(abs: string): Promise<boolean> {
  try {
    if (!looksLikeZipDocx(abs) || fs.statSync(abs).size === 0) {
      return false;
    }
    const zip = await JSZip.loadAsync(await fs.promises.readFile(abs));
    return Object.hasOwn(zip.files, "word/document.xml");
  } catch {
    return false;
  }
}

export async function reusableDocx(abs: string): Promise<boolean> {
  return isValidDocxPackage(abs);
}

export function siblingDocxRelative(relativePath: string): string {
  const posix = relativePath.replace(/\\/g, "/");
  const dir = path.posix.dirname(posix);
  const base = path.posix.basename(posix);
  const stem = base.replace(/\.[^.]+$/i, "");
  const outName = `${stem}.docx`;
  return dir === "." ? outName : path.posix.join(dir, outName);
}

export function siblingDocxAbs(absDoc: string): string {
  return path.join(path.dirname(absDoc), `${path.basename(absDoc).replace(/\.doc$/i, "")}.docx`);
}

/**
 * Convert with LibreOffice headless. Returns false when no converter is installed
 * or its output fails package validation. Never writes a partial file at `absOut`.
 */
export async function convertDocToDocxWithSoffice(
  absIn: string,
  absOut: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<boolean> {
  if (/[\r\n]/.test(absIn) || /[\r\n]/.test(absOut)) {
    return false;
  }
  return withResourceLease(RESOURCE_LEASE_SOFFICE, async () => {
    for (const bin of SOFFICE_CANDIDATES) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-soffice-"));
      try {
        const result = await runSafeCommand({
          command: bin,
          args: [
            "--headless",
            "--nologo",
            "--nolockcheck",
            "--nodefault",
            "--norestore",
            "--convert-to",
            "docx",
            "--outdir",
            tmpDir,
            absIn,
          ],
          env: buildMinimalChildEnv(),
          timeoutMs: opts?.timeoutMs ?? 180_000,
          signal: opts?.signal,
          killSignal: "SIGKILL",
          stdio: ["ignore", "ignore", "pipe"],
          maxStderrBytes: 4_000,
        }).catch(() => null);
        if (!result || result.exitCode !== 0) {
          continue;
        }
        const produced = fs.readdirSync(tmpDir).find((n) => n.toLowerCase().endsWith(".docx"));
        if (!produced) {
          continue;
        }
        const candidate = path.join(tmpDir, produced);
        if (!(await isValidDocxPackage(candidate))) {
          continue;
        }
        fs.mkdirSync(path.dirname(absOut), { recursive: true });
        fs.copyFileSync(candidate, absOut);
        return await isValidDocxPackage(absOut);
      } catch {
        continue;
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
    return false;
  });
}

/**
 * Make sure a workspace-relative attachment has a `.docx` form.
 *
 * `.doc` is converted by the lawyer's own Microsoft Word first (real Save As —
 * headers, tables, images, numbering and existing tracked changes come across),
 * then LibreOffice headless when Word is unavailable. A misnamed OOXML `.doc` is
 * copied as-is. With neither engine this fails loudly; it never hands back a
 * text-only stand-in that looks like the original layout.
 */
export async function ensureDocxForAttachment(
  workspaceDir: string,
  relativePath: string,
  opts?: { signal?: AbortSignal },
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
  if (!isLegacyDoc) {
    return { ok: false, error: "not_convertible" };
  }

  const outRel = siblingDocxRelative(rel);
  const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
  if (!resolvedOut.ok) {
    return { ok: false, error: "path_escape" };
  }

  if (looksLikeZipDocx(absIn)) {
    if (await isValidDocxPackage(absIn)) {
      fs.mkdirSync(path.dirname(resolvedOut.abs), { recursive: true });
      fs.copyFileSync(absIn, resolvedOut.abs);
      return {
        ok: true,
        relativePath: outRel,
        converted: true,
        tool: "zip-copy",
        fidelity: "high",
      };
    }
    return { ok: false, error: DOC_NEEDS_DOCX_MESSAGE };
  }

  if (await isValidDocxPackage(resolvedOut.abs)) {
    return { ok: true, relativePath: outRel, converted: false, tool: "existing", fidelity: "high" };
  }
  const result = await convertLegacyDocToDocx(absIn, resolvedOut.abs, { signal: opts?.signal });
  if (!result.ok) {
    try {
      fs.rmSync(resolvedOut.abs, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    relativePath: outRel,
    converted: true,
    tool: result.tool,
    fidelity: "high",
  };
}

/**
 * The single conversion entry point: Word first (no install, real Save As),
 * LibreOffice second. Both are validated packages; failures are explicit.
 */
export async function convertLegacyDocToDocx(
  absIn: string,
  absOut: string,
  opts?: { signal?: AbortSignal },
): Promise<{ ok: true; tool: "msword" | "soffice" } | { ok: false; error: string }> {
  const wordPresent = microsoftWordInstalled();
  if (await convertDocToDocxWithWord(absIn, absOut, { signal: opts?.signal })) {
    return { ok: true, tool: "msword" };
  }
  if (await convertDocToDocxWithSoffice(absIn, absOut, { signal: opts?.signal })) {
    return { ok: true, tool: "soffice" };
  }
  return { ok: false, error: wordPresent ? WORD_CONVERT_FAILED_MESSAGE : CONVERTER_NEEDED_MESSAGE };
}

/**
 * Middle-column preview: read the `.doc` body in-process. Text only — this is a
 * reading aid, not the deliverable; export always goes through the converter.
 */
export async function convertLegacyDocForPreview(
  workspaceDir: string,
  relativePath: string,
  _opts?: { signal?: AbortSignal },
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
    if (!(await isValidDocxPackage(absIn))) {
      return { ok: false, error: DOC_NEEDS_DOCX_MESSAGE };
    }
    const outRel = siblingDocxRelative(rel);
    const resolvedOut = resolveWorkspaceRelativePath(workspaceDir, outRel);
    if (!resolvedOut.ok) {
      return { ok: false, error: "path_escape" };
    }
    fs.mkdirSync(path.dirname(resolvedOut.abs), { recursive: true });
    fs.copyFileSync(absIn, resolvedOut.abs);
    return { ok: true, relativePath: outRel, converted: true, tool: "zip-copy", fidelity: "high" };
  }
  const text = await readBinaryWordDocText(absIn);
  if (!text.trim()) {
    return { ok: false, error: DOC_NEEDS_DOCX_MESSAGE };
  }
  return { ok: true, relativePath: rel, converted: false, tool: "existing", fidelity: "text-only" };
}
