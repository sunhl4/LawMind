/**
 * 跨文书一致改执行器 —— `apply_surgical_edits({ task_ids, edits })`.
 *
 * 为什么单独一个模块：engine-pipeline-tools.ts 已是冻结大文件（有行数棘轮），
 * 本地新能力应自己成模块，而不是把它撞大。
 */

import { randomUUID } from "node:crypto";
import type { CraftCheckInput } from "../../../drafts/contract-redline-craft.js";
import type {
  CrossDocumentChangeManifest,
  CrossDocumentDocChange,
} from "../../../drafts/cross-document-edits.js";
import {
  generateRedlineAfterWrite,
  persistDraft,
  prepareRedlineBaselineBeforeWrite,
  readDraft,
} from "../../../drafts/index.js";
import type { TerminologyDrift } from "../../../drafts/terminology-adapt.js";
import type { ArtifactSection } from "../../../types.js";
import type { AgentContext, ToolCallResult } from "../../types.js";

/**
 * 跨文书一致改批次号：按时间可排序，便于回查变更清单。
 */
export function newCrossDocumentBatchId(at: Date = new Date()): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/[-:]/g, "")
    .replace("T", "-");
  return `xdoc-${stamp}-${randomUUID().slice(0, 6)}`;
}

/**
 * 落改新引入的外来当事人叫法（不阻断，只提醒）。
 * 汇总在 `changes[].terminologyWarnings` 里（由 drafts 层算好），这里只做扁平化。
 */
function flattenTerminologyWarnings(
  changes: ReadonlyArray<{ taskId: string; terminologyWarnings: TerminologyDrift[] }>,
): Array<{ taskId: string; token: string; reason: string }> {
  const out: Array<{ taskId: string; token: string; reason: string }> = [];
  for (const change of changes) {
    for (const row of change.terminologyWarnings) {
      out.push({ taskId: change.taskId, ...row });
    }
  }
  return out;
}

/**
 * 同一锚定规则一次改多份文书（`apply_surgical_edits` + `task_ids`）。
 *
 * 与单份路径的区别只有三处，都为了「交付前不让律师介入」：
 * - **先全批预检再落笔**：任一份锚定不明/过宽 → 整批停、零落改（不做部分成功）。
 * - **命中 0 处的文书不算错**：一批合同里本就不一定都有该条款，记进变更清单。
 * - **逐份出自己的修订轨**，并落一份跨文书变更清单（谁改了哪几处、redlinePending 多少）。
 */
export async function executeCrossDocumentEdits(args: {
  params: Record<string, unknown>;
  ctx: AgentContext;
  taskIds: string[];
  craftCheck: CraftCheckInput | undefined;
}): Promise<ToolCallResult> {
  const { ctx } = args;
  const {
    parseCrossDocumentEditsInput,
    planCrossDocumentEdits,
    applyCrossDocumentEditsToSections,
    formatCrossDocumentSummary,
    manifestPath,
  } = await import("../../../drafts/cross-document-edits.js");

  let edits: ReturnType<typeof parseCrossDocumentEditsInput>;
  try {
    edits = parseCrossDocumentEditsInput(args.params.edits);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      data: { code: "edits_invalid" },
    };
  }

  const taskIds: string[] = [];
  for (const raw of args.taskIds) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id && !taskIds.includes(id)) {
      taskIds.push(id);
    }
  }
  if (taskIds.length === 0) {
    return { ok: false, error: "task_ids 不能为空。", data: { code: "no_documents" } };
  }

  // 1) 读入全批目标（缺一即停：部分成功会让律师更难核对）
  const documents: Array<{ taskId: string; title?: string; sections: ArtifactSection[] }> = [];
  for (const taskId of taskIds) {
    let draft = readDraft(ctx.workspaceDir, taskId);
    if (!draft) {
      return {
        ok: false,
        error: `找不到草稿 ${taskId}。跨文书一致改不做部分成功，本批未落改任何文书。`,
        data: { code: "draft_not_found", taskId, taskIds },
      };
    }
    const bodyChars = (draft.sections ?? []).reduce((n, s) => n + (s.body?.trim().length ?? 0), 0);
    const needsSeed = draft.sections.length === 0 || bodyChars < 40;
    if (needsSeed || !draft.contractEdit) {
      const { enrichDraftWithContractEditBaseline } =
        await import("../../../drafts/contract-edit-baseline.js");
      const { wordFilePinRelPaths } = await import("../../../drafts/paired-review-deliverable.js");
      const enriched = await enrichDraftWithContractEditBaseline({
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        draft,
        extraPaths: wordFilePinRelPaths(ctx.contextPins),
        mode: draft.contractEdit?.mode ?? "surgical",
        seedSections: needsSeed,
        pins: ctx.contextPins,
      });
      draft = enriched.draft;
      if (draft.clarificationQuestions?.length) {
        draft = { ...draft, clarificationQuestions: undefined };
      }
      persistDraft(ctx.workspaceDir, draft);
    }
    documents.push({
      taskId,
      ...(draft.title ? { title: draft.title } : {}),
      sections: draft.sections,
    });
  }

  // 2) 全批预检：过宽/多处命中未声明 → 整批停，零落改
  const plan = planCrossDocumentEdits({ documents, edits });
  if (!plan.ok) {
    return {
      ok: false,
      error: plan.error,
      data: {
        code: plan.code,
        conflicts: plan.conflicts,
        docs: plan.docs,
        taskIds,
        gateDecision: {
          gate: "cross_document_anchor_gate",
          decision: "block",
          reason: "跨文书一致改要求全批锚定唯一且最短；预检未过不得部分落改",
          category: "safety_hard",
        },
      },
    };
  }

  // 3) 逐份落笔 + 逐份出修订轨
  const applied = applyCrossDocumentEditsToSections(plan, documents);
  const sectionsByTask = new Map(applied.docs.map((d) => [d.taskId, d.sections]));
  const { writeRedlinePlan, readRedlinePlan } = await import("../../../drafts/redline-plan.js");
  const docs: Array<
    CrossDocumentDocChange & { redlinePending: number; redlineProposalPath: string }
  > = [];
  let redlineTotal = 0;
  for (const change of applied.changes) {
    const draft = readDraft(ctx.workspaceDir, change.taskId);
    const sections = sectionsByTask.get(change.taskId);
    if (!draft || !sections) {
      return {
        ok: false,
        error: `第 ${change.taskId} 份在落笔前丢失，本批已停止（已改文书见变更清单）。`,
        data: { code: "draft_lost_mid_batch", taskId: change.taskId, taskIds },
      };
    }
    prepareRedlineBaselineBeforeWrite(ctx.workspaceDir, change.taskId);
    persistDraft(ctx.workspaceDir, { ...draft, sections });
    const replaceByFind = new Map(plan.edits.map((e) => [e.find, e.replace]));
    try {
      const prior = readRedlinePlan(ctx.workspaceDir, change.taskId);
      writeRedlinePlan(ctx.workspaceDir, {
        taskId: change.taskId,
        items: change.applied.map((row) => ({
          find: row.find,
          replace: row.replace,
          ...(row.note ? { note: row.note } : {}),
        })),
        skipped: change.skipped.map((s) => ({
          find: s.find,
          replace: replaceByFind.get(s.find) ?? "",
          reason: s.reason,
        })),
        updatedAt: new Date().toISOString(),
        craftCheckAttached: true,
        writerDeferred: args.craftCheck?.deferred ?? prior?.writerDeferred,
      });
    } catch {
      /* plan sidecar is best-effort */
    }
    const redline = generateRedlineAfterWrite(ctx.workspaceDir, change.taskId);
    if (!redline.ok) {
      return {
        ok: false,
        error: `第 ${change.taskId} 份已落改，但 Redline 提案生成失败：${redline.error}`,
        data: { code: redline.error, taskId: change.taskId, taskIds },
      };
    }
    const pending = redline.proposal.hunks.filter((h) => h.status === "pending").length;
    redlineTotal += pending;
    docs.push({
      ...change,
      redlinePending: pending,
      redlineProposalPath: `drafts/${change.taskId}.redline.json`,
    });
  }

  const batchId = newCrossDocumentBatchId();
  const manifest: CrossDocumentChangeManifest = {
    batchId,
    generatedAt: new Date().toISOString(),
    anchors: plan.edits.map((e) => ({
      find: e.find,
      replace: e.replace,
      occurrences: e.occurrences ?? "first",
    })),
    totals: {
      documents: docs.length,
      documentsChanged: docs.filter((d) => d.changed).length,
      appliedAnchors: docs.reduce((n, d) => n + d.applied.length, 0),
      replacements: docs.reduce((n, d) => n + d.applied.reduce((m, a) => m + a.occurrences, 0), 0),
      anchorsMissed: docs.reduce((n, d) => n + d.missed.length, 0),
      redlinePending: redlineTotal,
    },
    docs,
  };

  const pathMod = await import("node:path");
  const fsMod = await import("node:fs");
  const manifestAbs = manifestPath(ctx.workspaceDir, batchId);
  const manifestRel = pathMod.relative(ctx.workspaceDir, manifestAbs).replace(/\\/g, "/");
  try {
    fsMod.mkdirSync(pathMod.dirname(manifestAbs), { recursive: true });
    fsMod.writeFileSync(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  } catch {
    /* 清单落盘失败不阻断：结果里已带逐份明细 */
  }

  const message = formatCrossDocumentSummary({ manifest, narrowed: plan.narrowed });
  const terminologyWarnings = flattenTerminologyWarnings(docs);
  return {
    ok: true,
    data: {
      batchId,
      taskIds,
      crossDocumentEdit: true as const,
      narrowed: plan.narrowed,
      redlinePending: redlineTotal,
      craftCheck: args.craftCheck ?? null,
      totals: manifest.totals,
      docs: docs.map((d) => ({
        taskId: d.taskId,
        ...(d.title ? { title: d.title } : {}),
        changed: d.changed,
        appliedCount: d.applied.length,
        replacements: d.applied.reduce((n, a) => n + a.occurrences, 0),
        skipped: d.skipped,
        missed: d.missed,
        redlinePending: d.redlinePending,
        redlineProposalPath: d.redlineProposalPath,
      })),
      manifestPath: manifestRel,
      message,
      ...(terminologyWarnings.length > 0
        ? {
            terminologyWarnings,
            terminologyNotice:
              "本次落改出现本文未定义的当事人叫法：请改用本文已定义术语（或用 search_precedents 的 term_map 对齐）后再逐份导出。",
          }
        : {}),
      ...(redlineTotal === 0
        ? {
            warning:
              "整批 redlinePending=0：正文相对各自基线无实质变化，请核对 find 是否为原文锚点。",
          }
        : {}),
    },
  };
}
