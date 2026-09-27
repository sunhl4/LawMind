/**
 * 批量采纳（风格记忆闭环）。
 *
 * 背景：Harvey Memory 的「自动学你怎么写」不需要律师确认；LawMind 的既有姿态是
 * **未确认零写入**（候选 `enabled: false` / `state: "pending"`）。这条姿态不能丢，
 * 但「逐条点确认」把律师钉在点击上，于是高频低风险的风格 delta 永远合不上环。
 *
 * 做法：把确认从「一条一次」变成「一批一次」，并强制两步：
 *   1. `planBatchAdoption` —— 纯读：列出这一批会写什么、写到哪、diff 多少（零写入）。
 *   2. `adoptBatch` —— 律师确认后才调用，逐条走既有写入面（含状态机与审计）。
 *
 * 未确认的一条都不写；写入面缺失的条目按既有口径记 `recorded_noop`，不假装生效。
 */

import { isDealSpecificLearningText } from "../learning/draft-edit-learning.js";
import { adoptLearningSuggestion } from "../learning/suggestion-queue.js";
import { applyMemoryAdoptionWrite } from "./adoption-apply.js";
import { buildAdoptionPreviewDiff } from "./adoption-preview-diff.js";
import {
  adoptMemorySuggestion,
  type MemoryAdoptionKind,
  type MemoryScope,
} from "./adoption-service.js";
import { listPendingAdoptionsUnified } from "./unified-pending-adoptions.js";

export const LEARNING_ID_PREFIX = "learning:";

/** 高频、低风险的风格 delta：措辞/习惯/条款写法，不改法律立场与案件事实。 */
export const LOW_RISK_STYLE_KINDS: readonly MemoryAdoptionKind[] = [
  "lawyer.profile_learning",
  "lawyer.habit_pattern",
  "firm.preference",
  "playbook.clause_learning",
  "review_label",
  "source.annotation",
];

export function learningSuggestionId(id: string): string | undefined {
  if (!id.startsWith(LEARNING_ID_PREFIX)) {
    return undefined;
  }
  const raw = id.slice(LEARNING_ID_PREFIX.length).trim();
  return raw || undefined;
}

export function isLowRiskStyleAdoption(item: { kind: string; payload?: string }): boolean {
  if (!(LOW_RISK_STYLE_KINDS as readonly string[]).includes(item.kind)) {
    return false;
  }
  if (
    (item.kind === "lawyer.profile_learning" || item.kind === "lawyer.habit_pattern") &&
    item.payload &&
    isDealSpecificLearningText(item.payload)
  ) {
    return false;
  }
  return true;
}

function payloadSummary(payload: string): string {
  const line = (payload ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) {
    return "(空内容)";
  }
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

export type BatchAdoptionPlanItem = {
  id: string;
  kind: string;
  scope: MemoryScope;
  targetId?: string;
  sourceTaskId?: string;
  /** 是否属「高频低风险风格 delta」。 */
  lowRiskStyle: boolean;
  summary: string;
  adoptable: boolean;
  blockedReason?: string;
  preview: {
    changed: boolean;
    targetPath?: string;
    beforeCharCount?: number;
    afterCharCount?: number;
    hunkCount?: number;
    hint?: string;
  };
};

export type BatchAdoptionPlan = {
  ok: true;
  dryRun: boolean;
  mode: "ids" | "low_risk_style";
  items: BatchAdoptionPlanItem[];
  /** 可以落盘的 id（律师确认后原样传给 adoptBatch）。 */
  adoptableIds: string[];
  blocked: Array<{ id: string; reason: string }>;
  note: string;
};

export type PlanBatchAdoptionOptions = {
  ids?: string[];
  mode?: "ids" | "low_risk_style";
  dryRun?: boolean;
  matterId?: string;
};

/**
 * 规划一批采纳：纯读，零写入。
 * `mode: "low_risk_style"` 时自动取全部待审项里的低频风险风格项（一次看全）。
 */
export async function planBatchAdoption(
  workspaceDir: string,
  opts: PlanBatchAdoptionOptions = {},
): Promise<BatchAdoptionPlan> {
  const mode = opts.mode ?? (opts.ids && opts.ids.length > 0 ? "ids" : "low_risk_style");
  const pending = await listPendingAdoptionsUnified(workspaceDir);
  const byId = new Map(pending.map((row) => [row.id, row]));

  let selected = pending;
  const requested = (opts.ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (mode === "ids") {
    selected = requested
      .map((id) => byId.get(id))
      .filter((row): row is (typeof pending)[number] => Boolean(row));
  } else {
    selected = pending.filter((row) => isLowRiskStyleAdoption(row));
  }
  if (opts.matterId) {
    selected = selected.filter((row) => row.targetId === opts.matterId);
  }

  const blocked: Array<{ id: string; reason: string }> = [];
  for (const id of requested) {
    if (!byId.has(id)) {
      blocked.push({ id, reason: "不在待审列表（可能已被采纳或忽略）" });
    }
  }

  const items: BatchAdoptionPlanItem[] = [];
  for (const row of selected) {
    const learnId = learningSuggestionId(row.id);
    const preview: BatchAdoptionPlanItem["preview"] = {
      changed: false,
    };
    if (learnId) {
      preview.hint = "审核标签学习：无正文 diff，采纳后写入习惯画像。";
    } else {
      const diff = await buildAdoptionPreviewDiff(
        workspaceDir,
        row.id,
        opts.matterId ? { matterId: opts.matterId } : {},
      );
      if (diff.ok) {
        preview.changed = diff.beforeCharCount !== diff.afterCharCount || diff.hunks.length > 0;
        preview.targetPath = diff.targetPath;
        preview.beforeCharCount = diff.beforeCharCount;
        preview.afterCharCount = diff.afterCharCount;
        preview.hunkCount = diff.hunks.length;
      } else {
        preview.hint = diff.hint ?? diff.error;
      }
    }
    items.push({
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      ...(row.targetId ? { targetId: row.targetId } : {}),
      ...(row.sourceTaskId ? { sourceTaskId: row.sourceTaskId } : {}),
      lowRiskStyle: isLowRiskStyleAdoption(row),
      summary: payloadSummary(row.payload),
      adoptable: true,
      preview,
    });
  }

  return {
    ok: true,
    dryRun: opts.dryRun !== false,
    mode,
    items,
    adoptableIds: items.filter((i) => i.adoptable).map((i) => i.id),
    blocked,
    note:
      items.length === 0
        ? "没有可采纳的待审项。"
        : `预览 ${items.length} 条；确认后一次写入 ${items.length} 条，未确认的一条都不写。`,
  };
}

export type BatchAdoptResult = {
  ok: boolean;
  adopted: string[];
  failed: Array<{ id: string; error: string }>;
  /** 采纳动作已记录但无落盘面（不宣称生效）。 */
  recordedNoop: string[];
};

/**
 * 落盘一批（仅律师确认后调用）。逐条复用既有写入面：
 * 状态机、审计、`recorded_noop` 语义与单条采纳完全一致。
 */
export async function adoptBatch(
  workspaceDir: string,
  auditDir: string,
  ids: string[],
  opts?: { actorId?: string; note?: string; envFile?: string },
): Promise<BatchAdoptResult> {
  const adopted: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];
  const recordedNoop: string[] = [];

  for (const rawId of ids) {
    const id = rawId.trim();
    if (!id) {
      continue;
    }
    const learnId = learningSuggestionId(id);
    if (learnId) {
      const result = await adoptLearningSuggestion(workspaceDir, auditDir, learnId);
      if (result.ok) {
        adopted.push(id);
      } else {
        failed.push({ id, error: result.error ?? "learning_adopt_failed" });
      }
      continue;
    }
    const result = await adoptMemorySuggestion(
      workspaceDir,
      auditDir,
      id,
      async (rec) =>
        applyMemoryAdoptionWrite(workspaceDir, rec, {
          ...(opts?.envFile ? { envFile: opts.envFile } : {}),
          auditDir,
        }),
      {
        ...(opts?.actorId ? { actorId: opts.actorId } : {}),
        ...(opts?.note ? { note: opts.note } : {}),
      },
    ).catch((err: unknown) => {
      // 单条写入面抛错不得掀掉整批：其余条目照常采纳，本条如实报失败。
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    });
    if (!result.ok) {
      failed.push({ id, error: result.error ?? "adopt_failed" });
      continue;
    }
    if (result.record?.state === "recorded_noop") {
      recordedNoop.push(id);
    }
    adopted.push(id);
  }

  return { ok: failed.length === 0, adopted, failed, recordedNoop };
}
