/**
 * 跨文书一致改（batch consistent edits）。
 *
 * 场景：同一个当事人名 / 术语 / 条款措辞在 N 份文书里必须改成同一口径
 * （Spellbook Associate 的「一个指令改一批文件」）。
 *
 * 两条硬约束，都是为了「交付前不让律师介入」：
 *
 * 1. **先全批预检，再动笔**。任一份出现「同一锚点多处命中且未声明统一替换」
 *    或跨度超硬门禁 → 整批停、零写入，并把冲突逐份列清。
 *    模型可以自己改成 `occurrences: "all"` 重来，不需要律师仲裁。
 * 2. **找不到锚点的文书不算错**。一批合同里本来就可能只有几份含该条款：
 *    记进变更清单（missed），不编造、不静默跳过。
 *
 * 本模块不碰文件系统：规划与落笔都是纯函数，持久化与 Redline 由调用方负责。
 */

import path from "node:path";
import type { ArtifactSection } from "../types.js";
import type { SurgicalTextEdit } from "./apply-surgical-edits.js";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";
import { introducedTerminologyDrift, type TerminologyDrift } from "./terminology-adapt.js";

/** 一处输入编辑最多拆成多少段最短改动（与单份路径同一口径）。 */
const MAX_SPANS_PER_CROSS_EDIT = 64;

/** 锚定命中多处的处理口径：只改第一处，或整批统一全改。 */
export type CrossDocumentOccurrenceMode = "first" | "all";

export type CrossDocumentEdit = SurgicalTextEdit & {
  /** 缺省 first：命中多处会被整批拦下，须显式声明 all 才统一替换。 */
  occurrences?: CrossDocumentOccurrenceMode;
};

export type CrossDocumentDoc = {
  taskId: string;
  title?: string;
  sections: ArtifactSection[];
};

export type CrossDocumentDocPlan = {
  taskId: string;
  title?: string;
  /** 该份文书里每个锚点的命中次数（0 = 本件无此锚点）。 */
  occurrences: Record<string, number>;
  /** 命中 ≥1 处的锚点数。 */
  matched: number;
  /** 本件找不到的锚点（诚实记录，不算错）。 */
  missed: string[];
};

export type CrossDocumentPlanConflict = {
  taskId: string;
  find: string;
  count: number;
};

export type CrossDocumentPlan =
  | {
      ok: true;
      /** 预检后统一使用的锚点（可能已按最短锚定收窄）。 */
      edits: CrossDocumentEdit[];
      /** 收窄过的锚点数。 */
      narrowed: number;
      docs: CrossDocumentDocPlan[];
      totalMatches: number;
    }
  | {
      ok: false;
      code: "no_documents" | "no_edits" | "span_too_wide" | "anchor_ambiguous";
      error: string;
      docs: CrossDocumentDocPlan[];
      conflicts: CrossDocumentPlanConflict[];
    };

/** 单份文书的落改记录（进变更清单）。 */
export type CrossDocumentDocChange = {
  taskId: string;
  title?: string;
  applied: Array<{
    find: string;
    replace: string;
    note?: string;
    /** 实际替换处数。 */
    occurrences: number;
    /** 落在哪些节（节下标）。 */
    sections: number[];
  }>;
  skipped: Array<{ find: string; reason: string }>;
  /** 本件未被触及的锚点（本件无此锚点）。 */
  missed: string[];
  changed: boolean;
  /** 本次落改新引入的外来当事人叫法（术语自适应兜底，不阻断）。 */
  terminologyWarnings: TerminologyDrift[];
};

export type CrossDocumentSectionsResult = {
  docs: Array<{ taskId: string; sections: ArtifactSection[] }>;
  changes: CrossDocumentDocChange[];
};

function countOccurrences(text: string, find: string): number {
  if (!find) {
    return 0;
  }
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(find, from);
    if (at < 0) {
      return count;
    }
    count += 1;
    from = at + find.length;
  }
}

function countInSections(sections: ArtifactSection[], find: string): number {
  let total = 0;
  for (const section of sections) {
    total += countOccurrences(section.body ?? "", find);
  }
  return total;
}

/**
 * 统一锚定：每处输入编辑都重算成**若干最短改动**（保留文字不进修订轨）。
 * 展开结果对全批一致生效，避免「A 文书拆了、B 文书没拆」造成口径漂移。
 */
function normalizeCrossDocumentEdits(
  edits: CrossDocumentEdit[],
): { ok: true; edits: CrossDocumentEdit[]; narrowed: number } | { ok: false; error: string } {
  const out: CrossDocumentEdit[] = [];
  let narrowed = 0;
  for (const raw of edits) {
    const find = typeof raw.find === "string" ? raw.find : "";
    const replace = typeof raw.replace === "string" ? raw.replace : "";
    if (!find || find === replace) {
      return { ok: false, error: `锚点为空或 find 与 replace 相同（「${find.slice(0, 24)}」）。` };
    }
    const spans = computeMinimalEditSpans(find, replace);
    if (spans.length === 0) {
      return { ok: false, error: `锚点「${find.slice(0, 24)}」没有实质改动。` };
    }
    if (spans.length > MAX_SPANS_PER_CROSS_EDIT) {
      return {
        ok: false,
        error: `锚点「${find.slice(0, 24)}」的改动过于碎片化（${spans.length} 段）；请按实质应改点分条提交。`,
      };
    }
    const minimized = spans.length > 1 || spans[0]?.before !== find || spans[0]?.after !== replace;
    if (minimized) {
      narrowed += 1;
    }
    for (const span of spans) {
      const note = [raw.note, minimized ? "已按最短改动拆分" : undefined]
        .filter(Boolean)
        .join("；");
      if (span.before.length > 0) {
        out.push({
          ...raw,
          find: span.before,
          replace: span.after,
          ...(note ? { note } : {}),
        });
        continue;
      }
      // 纯插入：这一层只管**内容**（Word 修订轨的最小化由 redline 生成时重算），
      // 故写成「原 find → 插入后的原 find」，位置精确、不依赖后续是否有正文。
      const withInsert = find.slice(0, span.spanStart) + span.after + find.slice(span.spanStart);
      out.push({
        ...raw,
        find,
        replace: withInsert,
        ...(note ? { note } : {}),
      });
    }
  }
  return { ok: true, edits: out, narrowed };
}

/**
 * 预检：全批统一锚定 + 逐份命中统计。
 * 结果 ok:false 时调用方**不得**写入任何一份文书。
 */
export function planCrossDocumentEdits(params: {
  documents: CrossDocumentDoc[];
  edits: CrossDocumentEdit[];
}): CrossDocumentPlan {
  const docs = params.documents ?? [];
  if (docs.length === 0) {
    return {
      ok: false,
      code: "no_documents",
      error: "跨文书一致改需要至少 1 份文书。",
      docs: [],
      conflicts: [],
    };
  }
  const rawEdits = (params.edits ?? []).filter((e) => (e?.find ?? "").length > 0);
  if (rawEdits.length === 0) {
    return {
      ok: false,
      code: "no_edits",
      error: "edits 不能为空；请提供至少 1 组 find/replace。",
      docs: [],
      conflicts: [],
    };
  }
  const normalized = normalizeCrossDocumentEdits(rawEdits);
  if (!normalized.ok) {
    return { ok: false, code: "span_too_wide", error: normalized.error, docs: [], conflicts: [] };
  }

  const docPlans: CrossDocumentDocPlan[] = [];
  const conflicts: CrossDocumentPlanConflict[] = [];
  let totalMatches = 0;

  for (const doc of docs) {
    const occurrences: Record<string, number> = {};
    const missed: string[] = [];
    let matched = 0;
    for (const edit of normalized.edits) {
      const count = countInSections(doc.sections ?? [], edit.find);
      occurrences[edit.find] = count;
      if (count === 0) {
        missed.push(edit.find);
        continue;
      }
      matched += 1;
      totalMatches += count;
      const mode = edit.occurrences ?? "first";
      if (count > 1 && mode !== "all") {
        conflicts.push({ taskId: doc.taskId, find: edit.find, count });
      }
    }
    docPlans.push({
      taskId: doc.taskId,
      ...(doc.title ? { title: doc.title } : {}),
      occurrences,
      matched,
      missed,
    });
  }

  if (conflicts.length > 0) {
    const head = conflicts
      .slice(0, 3)
      .map((c) => `${c.taskId}「${c.find}」×${c.count}`)
      .join("；");
    return {
      ok: false,
      code: "anchor_ambiguous",
      error: `锚点在多份文书里多处命中，未确定改哪一处：${head}${conflicts.length > 3 ? " …" : ""}。若确为当事人名/术语统一替换，请对该条显式传 occurrences: "all" 后整批重来（本次未写入任何文书）。`,
      docs: docPlans,
      conflicts,
    };
  }

  return {
    ok: true,
    edits: normalized.edits,
    narrowed: normalized.narrowed,
    docs: docPlans,
    totalMatches,
  };
}

/**
 * 按预检结果落笔（纯函数）：同一锚定规则作用在每一份上。
 * 调用方须先确认 plan.ok。
 */
export function applyCrossDocumentEditsToSections(
  plan: Extract<CrossDocumentPlan, { ok: true }>,
  documents: CrossDocumentDoc[],
): CrossDocumentSectionsResult {
  const docs: Array<{ taskId: string; sections: ArtifactSection[] }> = [];
  const changes: CrossDocumentDocChange[] = [];

  for (const doc of documents) {
    const planned = plan.docs.find((d) => d.taskId === doc.taskId);
    const sections = (doc.sections ?? []).map((s) => ({
      ...s,
      body: s.body ?? "",
      citations: s.citations ? [...s.citations] : undefined,
    }));
    const applied: CrossDocumentDocChange["applied"] = [];
    const skipped: CrossDocumentDocChange["skipped"] = [];
    const missed: string[] = [];

    for (const edit of plan.edits) {
      const hits = planned?.occurrences[edit.find] ?? countInSections(sections, edit.find);
      if (hits === 0) {
        missed.push(edit.find);
        skipped.push({ find: edit.find, reason: "本件无此锚点（原文不含 find）" });
        continue;
      }
      const mode = edit.occurrences ?? "first";
      const touched: number[] = [];
      let replaced = 0;
      for (let i = 0; i < sections.length; i += 1) {
        const body = sections[i].body ?? "";
        if (!body.includes(edit.find)) {
          continue;
        }
        let nextBody: string;
        if (mode === "all") {
          const count = countOccurrences(body, edit.find);
          nextBody = body.split(edit.find).join(edit.replace);
          replaced += count;
        } else {
          nextBody = body.replace(edit.find, edit.replace);
          replaced += 1;
        }
        if (nextBody !== body) {
          sections[i] = { ...sections[i], body: nextBody };
          touched.push(i);
        }
        if (mode === "first") {
          break;
        }
      }
      if (replaced === 0) {
        skipped.push({ find: edit.find, reason: "落改后正文未变化（replace 与原文相同）" });
        continue;
      }
      applied.push({
        find: edit.find,
        replace: edit.replace,
        ...(edit.note ? { note: edit.note } : {}),
        occurrences: replaced,
        sections: touched,
      });
    }

    docs.push({ taskId: doc.taskId, sections });
    changes.push({
      taskId: doc.taskId,
      ...(doc.title ? { title: doc.title } : {}),
      applied,
      skipped,
      missed,
      changed: applied.length > 0,
      terminologyWarnings: introducedTerminologyDrift(
        (doc.sections ?? []).map((s) => s.body ?? "").join("\n"),
        sections.map((s) => s.body ?? "").join("\n"),
      ),
    });
  }

  return { docs, changes };
}

/** 变更清单（可落盘、可读）。 */
export type CrossDocumentChangeManifest = {
  batchId: string;
  generatedAt: string;
  anchors: Array<{ find: string; replace: string; occurrences: CrossDocumentOccurrenceMode }>;
  totals: {
    documents: number;
    documentsChanged: number;
    appliedAnchors: number;
    replacements: number;
    anchorsMissed: number;
    redlinePending: number;
  };
  docs: Array<
    CrossDocumentDocChange & {
      redlinePending: number;
      /** 每份的 Redline 提案文件（相对工作区），便于逐份核对修订轨。 */
      redlineProposalPath?: string;
    }
  >;
};

export function manifestPath(workspaceDir: string, batchId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${batchId}.cross-document.json`);
}

/** 解析工具入参里的 edits（含 occurrences 口径）。 */
export function parseCrossDocumentEditsInput(value: unknown): CrossDocumentEdit[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("edits 必须是非空数组，每项为 { find, replace, occurrences?, note? }");
  }
  return value.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new Error(`edits[${idx}] 格式无效`);
    }
    const record = item as Record<string, unknown>;
    const find = typeof record.find === "string" ? record.find : "";
    const replace = typeof record.replace === "string" ? record.replace : "";
    const note = typeof record.note === "string" ? record.note : undefined;
    if (!find) {
      throw new Error(`edits[${idx}].find 不能为空`);
    }
    const raw = record.occurrences;
    if (raw !== undefined && raw !== "first" && raw !== "all") {
      throw new Error(`edits[${idx}].occurrences 只能是 "first" 或 "all"`);
    }
    return {
      find,
      replace,
      ...(note !== undefined ? { note } : {}),
      ...(raw === "all" ? { occurrences: "all" as const } : {}),
    };
  });
}

/** 人读摘要：逐份一行，律师一眼看到「哪几份改了、哪几份本件无此锚点」。 */
export function formatCrossDocumentSummary(input: {
  manifest: CrossDocumentChangeManifest;
  narrowed: number;
}): string {
  const { manifest } = input;
  const lines = [
    `跨文书一致改：${manifest.totals.documents} 份中 ${manifest.totals.documentsChanged} 份落改，共 ${manifest.totals.replacements} 处，redlinePending=${manifest.totals.redlinePending}。`,
  ];
  if (input.narrowed > 0) {
    lines.push(`统一收窄锚定 ${input.narrowed} 条（收窄口径已对全批生效）。`);
  }
  for (const doc of manifest.docs) {
    const label = doc.title?.trim() || doc.taskId;
    if (doc.applied.length === 0) {
      lines.push(`- ${label}：本件无待改锚点（${doc.missed.length} 条未命中）`);
      continue;
    }
    const detail = doc.applied
      .map((a) => `「${a.find}」→「${a.replace}」×${a.occurrences}`)
      .join("、");
    lines.push(
      `- ${label}：${detail}；redlinePending=${doc.redlinePending}${doc.missed.length > 0 ? `（另有 ${doc.missed.length} 条本件无此锚点）` : ""}`,
    );
  }
  return lines.join("\n");
}
