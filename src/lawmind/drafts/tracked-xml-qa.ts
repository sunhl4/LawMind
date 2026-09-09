/**
 * Post-export check: did officecli actually persist w:ins / w:del?
 * Engine-internal. Never a lawyer-facing approval page.
 * Frozen mail/word tool names stay apply_surgical_edits / render_tracked_draft.
 */

import fs from "node:fs/promises";
import JSZip from "jszip";

export type TrackedXmlQa = {
  ok: boolean;
  insCount: number;
  delCount: number;
  expectedHunks: number;
  warning?: string;
};

function countTag(xml: string, tag: "ins" | "del"): number {
  const re = tag === "ins" ? /<w:ins[\s>]/g : /<w:del[\s>]/g;
  return xml.match(re)?.length ?? 0;
}

export async function qaTrackedDocxXml(
  filePath: string,
  expectedHunks: number,
): Promise<TrackedXmlQa> {
  let xml = "";
  try {
    const buf = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  } catch {
    return {
      ok: false,
      insCount: 0,
      delCount: 0,
      expectedHunks,
      warning: "无法打开导出的 Word 做修订 XML 核对。",
    };
  }
  if (!xml) {
    return {
      ok: false,
      insCount: 0,
      delCount: 0,
      expectedHunks,
      warning: "导出文件没有 word/document.xml。",
    };
  }
  const insCount = countTag(xml, "ins");
  const delCount = countTag(xml, "del");
  if (expectedHunks > 0 && insCount + delCount === 0) {
    return {
      ok: false,
      insCount,
      delCount,
      expectedHunks,
      warning:
        "已报叠加修订，但 XML 未见 w:ins/w:del。不要当红线已落盘。收窄 find 后重跑 apply_surgical_edits 再导出。",
    };
  }
  return { ok: true, insCount, delCount, expectedHunks };
}
