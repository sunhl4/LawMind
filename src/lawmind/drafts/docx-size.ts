/**
 * .docx 进入解析器前的体积/条目上限。
 *
 * 为什么要有这一层：
 *   - `JSZip.loadAsync` 会把整个压缩包读进内存并建索引，一个几百 MB 的
 *     （或刻意构造的）zip 能把本地服务卡死几十秒，律师以为界面挂了；
 *   - 条目数同理：合法 Word 文件一般几十个部件，几千个条目只可能是恶意/损坏。
 *
 * 上限与工具侧读取保持同一口径（`MAX_DOCX_READ_BYTES`，20MB），
 * 不做「审计能读、工具读不了」的两套标准。
 */

import fs from "node:fs/promises";
import JSZip from "jszip";

/** 与 `agent/tools/legal/ingest-helpers.ts` 的 `MAX_DOCX_READ_BYTES` 同值。 */
export const MAX_DOCX_BYTES = 20_000_000;
/** Word 正文 + 样式 + 编号 + 页眉页脚通常在 100 以内；留足余量。 */
export const MAX_DOCX_ENTRIES = 4_000;

export type DocxSizeCheck = { ok: true; bytes: number } | { ok: false; reason: string };

/** 只读元信息，不读正文。 */
export async function checkDocxSize(absPath: string): Promise<DocxSizeCheck> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return { ok: false, reason: "读不到这份文件。" };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "这不是一个文件。" };
  }
  if (stat.size > MAX_DOCX_BYTES) {
    return {
      ok: false,
      reason: `文件超过 ${Math.round(MAX_DOCX_BYTES / 1024 / 1024)}MB（${stat.size} 字节），本机不解析，请先在 Word 里拆分。`,
    };
  }
  return { ok: true, bytes: stat.size };
}

/**
 * 过限检查后加载 zip。超限/条目过多时返回 undefined 并给出原因，
 * 调用方必须把它当成「没读到」，不能当成「空文档」。
 */
export async function loadDocxZip(
  absPath: string,
): Promise<{ ok: true; zip: JSZip } | { ok: false; reason: string }> {
  const size = await checkDocxSize(absPath);
  if (!size.ok) {
    return size;
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.readFile(absPath));
  } catch {
    return {
      ok: false,
      reason: "不是有效的 .docx（压缩包损坏，或旧版 .doc 直接改了后缀）。",
    };
  }
  const entries = Object.keys(zip.files).length;
  if (entries > MAX_DOCX_ENTRIES) {
    return {
      ok: false,
      reason: `压缩包内有 ${entries} 个部件（上限 ${MAX_DOCX_ENTRIES}），不像正常 Word 文件，已停止解析。`,
    };
  }
  return { ok: true, zip };
}
