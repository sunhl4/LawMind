/**
 * Post-export check: did officecli actually persist w:ins / w:del?
 * Engine-internal. Never a lawyer-facing approval page.
 * Frozen mail/word tool names stay apply_surgical_edits / render_tracked_draft.
 *
 * 同时复核**最短改动**硬不变量（2026-09-20 起为全链路要求）：
 * 一处修订里若夹着大段没动的文字，说明这一处是「整句删 + 整句增」，
 * 同事在 Word 里没法逐处接受。引擎在落盘前已按最短改动重算（见
 * `minimal-edit-script.ts` 与 `render-docx-tracked.ts::resolveOfficeCliFindReplaceOps`），
 * 这里是对**实际写出的 .docx** 做最后一道独立核对：只要 XML 里出现这种修订对，
 * 就说明有路径绕过了重算。
 */

import fs from "node:fs/promises";
import JSZip from "jszip";
import { longestUnchangedRunInside } from "./minimal-edit-script.js";

export type TrackedXmlQa = {
  ok: boolean;
  insCount: number;
  delCount: number;
  expectedHunks: number;
  warning?: string;
  /** 最短改动复核结果（advisory 姿态下仍会出现在结果里）。 */
  minimalEdit: {
    checked: boolean;
    /** 检出的「删/增相邻」修订对数量。 */
    pairs: number;
    violations: Array<{
      deleted: string;
      inserted: string;
      unchangedRun: number;
      reason: string;
    }>;
  };
};

/**
 * 判定「这对删/增是整句改写」的门槛。
 *
 * 为什么不是直接用 MINIMAL_EDIT_MAX_UNCHANGED_RUN(6)：officecli 可能把一处替换切成多个
 * w:del/w:ins 片段，相邻片段未必属于同一对。要在**文件级**下断言，门槛必须收到
 * 「几乎不可能是巧合」的量级——两侧都够长、且共有片段占较短一侧的大半。
 */
const XML_PAIR_MIN_SIDE_CHARS = 12;
const XML_PAIR_MIN_UNCHANGED_RUN = 8;
const XML_PAIR_MIN_SHARED_RATIO = 0.6;

function countTag(xml: string, tag: "ins" | "del"): number {
  const re = tag === "ins" ? /<w:ins[\s>]/g : /<w:del[\s>]/g;
  return xml.match(re)?.length ?? 0;
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 抽出一段修订里的纯文本（w:del 用 w:delText，w:ins 用 w:t）。 */
function revisionText(body: string, kind: "ins" | "del"): string {
  const tag = kind === "ins" ? "w:t" : "w:delText";
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let out = "";
  for (const m of body.matchAll(re)) {
    out += decodeXmlText(m[1] ?? "");
  }
  return out;
}

/**
 * 按文档顺序取出所有修订片段。合并两类匹配并按出现位置排序，
 * 于是「删紧跟增」这种 officecli 的替换形状可以被相邻配对。
 */
export function extractRevisionRuns(xml: string): Array<{ kind: "ins" | "del"; text: string }> {
  const runs: Array<{ kind: "ins" | "del"; text: string; at: number }> = [];
  for (const [tag, kind] of [
    ["w:ins", "ins"],
    ["w:del", "del"],
  ] as const) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
    for (const m of xml.matchAll(re)) {
      runs.push({ kind, text: revisionText(m[1] ?? "", kind), at: m.index ?? 0 });
    }
  }
  return runs.toSorted((a, b) => a.at - b.at).map(({ kind, text }) => ({ kind, text }));
}

/**
 * 检出「删/增相邻且几乎同句」的修订对（= 整句删+整句增）。
 * 这是最短改动的反面，也是多人在 Word 上协作时最难受的形态。
 */
export function findNonMinimalRevisionPairs(xml: string): Array<{
  deleted: string;
  inserted: string;
  unchangedRun: number;
  reason: string;
}> {
  const runs = extractRevisionRuns(xml);
  const out: Array<{
    deleted: string;
    inserted: string;
    unchangedRun: number;
    reason: string;
  }> = [];
  for (let i = 0; i + 1 < runs.length; i += 1) {
    const del = runs[i];
    const ins = runs[i + 1];
    if (del.kind !== "del" || ins.kind !== "ins") {
      continue;
    }
    const deleted = del.text;
    const inserted = ins.text;
    const shorter = Math.min(deleted.length, inserted.length);
    if (shorter < XML_PAIR_MIN_SIDE_CHARS) {
      continue;
    }
    const unchangedRun = longestUnchangedRunInside({ before: deleted, after: inserted });
    if (unchangedRun < XML_PAIR_MIN_UNCHANGED_RUN) {
      continue;
    }
    if (unchangedRun / shorter < XML_PAIR_MIN_SHARED_RATIO) {
      continue;
    }
    out.push({
      deleted: deleted.slice(0, 60),
      inserted: inserted.slice(0, 60),
      unchangedRun,
      reason: `这一处改动的删/增几乎同句（共有 ${unchangedRun} 字未改），应只标真正变动的字`,
    });
  }
  return out;
}

export async function qaTrackedDocxXml(
  filePath: string,
  expectedHunks: number,
): Promise<TrackedXmlQa> {
  const emptyMinimalEdit = { checked: false, pairs: 0, violations: [] };
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
      minimalEdit: emptyMinimalEdit,
    };
  }
  if (!xml) {
    return {
      ok: false,
      insCount: 0,
      delCount: 0,
      expectedHunks,
      warning: "导出文件没有 word/document.xml。",
      minimalEdit: emptyMinimalEdit,
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
      minimalEdit: emptyMinimalEdit,
    };
  }
  // 最短改动复核：只在真发生修订时看（空修订已在上一条拦下）。
  const pairs = insCount + delCount > 0 ? Math.floor((insCount + delCount) / 2) : 0;
  const violations = insCount > 0 && delCount > 0 ? findNonMinimalRevisionPairs(xml) : [];
  const minimalEdit = { checked: true, pairs, violations };
  if (violations.length > 0) {
    const head = violations[0];
    return {
      ok: false,
      insCount,
      delCount,
      expectedHunks,
      minimalEdit,
      warning:
        `导出的修订轨里有 ${violations.length} 处「整句删+整句增」（共有 ${head.unchangedRun} 字未改却被包进修订）：` +
        `${head.deleted} → ${head.inserted}。这不符合最短改动要求（同事无法逐处接受）；` +
        "请确认这次落改没有绕过引擎的最短改动重算，然后重跑 apply_surgical_edits 再导出。",
    };
  }
  return { ok: true, insCount, delCount, expectedHunks, minimalEdit };
}
