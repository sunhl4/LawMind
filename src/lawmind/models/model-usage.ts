/**
 * Local model token usage ledger (agentsview-style, workspace-local only).
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { classifyModelWorkTier, modelWorkTierLabel, type ModelWorkTier } from "./model-tier.js";

export type ModelUsageSnapshot = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /**
   * 命中前缀缓存的输入 token（2026-10-21 新增）。
   * `undefined` = 上游没报，表示「未知」，不是 0。
   */
  cachedTokens?: number;
  /** 未命中缓存的输入 token；上游没报时按 prompt - cached 推定，仍未知则留空。 */
  uncachedTokens?: number;
  /** 推理 token（reasoning），上游单独计时填。 */
  reasoningTokens?: number;
};

/** 一次模型 HTTP 的账：这是成本核算的最小单位，不是回合汇总。 */
export type ModelCallUsageRow = {
  id: string;
  recordedAt: string;
  sessionId?: string;
  turnId?: string;
  matterId?: string;
  model?: string;
  provider?: string;
  /** 第几次尝试（含重试）；1 = 首发。 */
  attempt: number;
  /** 这次调用的用途：主循环 / 子工 / 压缩摘要 / 审稿 / 标题等。 */
  purpose?: ModelUsagePurpose;
  inputTokens?: number;
  cachedTokens?: number;
  uncachedTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  /** 端到端耗时（含排队等模型位）。 */
  latencyMs?: number;
  /** 是否失败；失败也记账，否则成本永远少算。 */
  failed?: boolean;
  /** 失败原因类别（不含正文）。 */
  errorKind?: string;
  /** 计费口径：自备密钥走 byok，平台额度走 subscription。 */
  billingScope: ModelBillingScope;
  /**
   * 首轮固定税估算：系统提示 + 实际发出的工具 schema。
   * 仅当调用方算得出时填；未知留空，不填 0。
   */
  fixedInputTokens?: number;
  /** 工具表指纹：用来验证「前缀是否稳定」。缺失表示未记录。 */
  toolTableFingerprint?: string;
};

export type ModelUsagePurpose =
  | "parent_turn"
  | "worker"
  | "compact_digest"
  | "review"
  | "guardian"
  | "router"
  /** 图片 / PDF 视觉 OCR 兜底（图片 token 单价高）。 */
  | "ocr"
  | "title"
  /** 案卷简报 / 案卷行热因这类桌面侧栏摘要；同样消耗真实 token。 */
  | "matter_brief"
  | "matter_hotline"
  /** 旧引擎模型成稿（`buildDraftWithModel`）。 */
  | "draft"
  /** 工作流指令解析（`parseDirectiveWithModel`）。 */
  | "plan"
  /** 回合级汇总行（旧口径）。有逐次调用行时，汇总不计入统计以免重复。 */
  | "turn_rollup"
  | "other";

export type ModelBillingScope = "byok" | "subscription";

const entrySchema = z.object({
  id: z.string(),
  recordedAt: z.string(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  matterId: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  /** 每次模型 HTTP 一条；旧账本缺省视为 1（回合汇总）。 */
  attempt: z.number().int().nonnegative().optional(),
  purpose: z.string().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  /** 以下均为「作者未知时缺省」，旧行没有这些字段也能读。 */
  cachedTokens: z.number().int().nonnegative().optional(),
  uncachedTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  failed: z.boolean().optional(),
  errorKind: z.string().optional(),
  billingScope: z.enum(["byok", "subscription"]).optional(),
  fixedInputTokens: z.number().int().nonnegative().optional(),
  toolTableFingerprint: z.string().optional(),
});

export type ModelUsageLedgerEntry = z.infer<typeof entrySchema>;

export type ModelUsageSummary = {
  entries: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Totals cover reported usage only; missing provider usage remains explicitly counted. */
  unknownUsageEntries?: number;
  /** ISO date of oldest included row */
  since?: string;
  /** ISO date of newest included row */
  until?: string;
  byBillingScope?: Array<{
    billingScope: ModelBillingScope | "unknown";
    entries: number;
    totalTokens: number;
    unknownUsageEntries: number;
  }>;
  byModel?: Array<{ model: string; entries: number; totalTokens: number }>;
  /** Heuristic Worker / Advisor / 通用 buckets (not billing). */
  byTier?: Array<{
    tier: ModelWorkTier;
    label: string;
    entries: number;
    totalTokens: number;
  }>;
};

function ledgerPath(workspaceDir: string): string {
  return path.join(workspaceDir, "model-usage", "ledger.jsonl");
}

function readLedger(workspaceDir: string): ModelUsageLedgerEntry[] {
  const file = ledgerPath(workspaceDir);
  if (!existsSync(file)) {
    return [];
  }
  const raw = readFileSync(file, "utf8");
  const out: ModelUsageLedgerEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = entrySchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        out.push(parsed.data);
      }
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/** 账本只读视图（脚本/诊断用）：坏行跳过，不静默补零。 */
export function listModelUsageLedger(workspaceDir: string): ModelUsageLedgerEntry[] {
  return readLedger(workspaceDir);
}

export function recordModelUsage(
  workspaceDir: string,
  row: Omit<ModelUsageLedgerEntry, "id" | "recordedAt"> & { id?: string; recordedAt?: string },
): ModelUsageLedgerEntry {
  const file = ledgerPath(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const entry: ModelUsageLedgerEntry = {
    id: row.id ?? `usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: row.recordedAt ?? new Date().toISOString(),
    sessionId: row.sessionId,
    turnId: row.turnId,
    matterId: row.matterId,
    model: row.model,
    provider: row.provider,
    attempt: row.attempt,
    purpose: row.purpose,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    totalTokens: row.totalTokens,
    cachedTokens: row.cachedTokens,
    uncachedTokens: row.uncachedTokens,
    reasoningTokens: row.reasoningTokens,
    latencyMs: row.latencyMs,
    failed: row.failed,
    errorKind: row.errorKind,
    billingScope: row.billingScope,
    fixedInputTokens: row.fixedInputTokens,
    toolTableFingerprint: row.toolTableFingerprint,
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

/** The single per-attempt recorder used by parent and worker model calls. */
export function createModelUsageRecorder(
  workspaceDir: string,
  context: {
    sessionId?: string;
    turnId?: string;
    matterId?: string;
    model?: string;
    provider?: string;
    purpose: ModelUsagePurpose;
    billingScope?: ModelBillingScope;
    fixedInputTokens?: number;
    toolTableFingerprint?: string;
  },
): (event: {
  attempt: number;
  latencyMs: number;
  failed: boolean;
  errorKind?: string;
  usage?: Parameters<typeof usageFromProvider>[0];
}) => void {
  return (event) => {
    try {
      const usage = usageFromProvider(event.usage);
      recordModelUsage(workspaceDir, {
        ...context,
        billingScope: context.billingScope ?? "byok",
        ...usage,
        attempt: event.attempt,
        latencyMs: event.latencyMs,
        failed: event.failed,
        errorKind: event.errorKind,
      });
    } catch {
      /* Accounting failure must not replay a model request. */
    }
  };
}

/** Renderer must import this from model-usage-format.ts — this file uses node:fs. */
export { formatUsageSummaryForLawyer } from "./model-usage-format.js";

/**
 * 同一回合同时存在「逐次调用行」与「回合汇总行」时，只算逐次调用行。
 *
 * 否则一次回合会被计两遍（汇总行 = 各次之和）。历史上只有汇总行的回合照常计入，
 * 所以旧账本不会因此变少。
 */
export function dropSupersededRollupRows(
  entries: readonly ModelUsageLedgerEntry[],
): ModelUsageLedgerEntry[] {
  const turnsWithPerCall = new Set<string>();
  for (const entry of entries) {
    if (
      (entry.purpose === "parent_turn" || entry.purpose === undefined) &&
      typeof entry.attempt === "number" &&
      entry.attempt > 0 &&
      entry.turnId
    ) {
      turnsWithPerCall.add(`${entry.sessionId ?? ""}:${entry.turnId}`);
    }
  }
  if (turnsWithPerCall.size === 0) {
    return [...entries];
  }
  return entries.filter(
    (entry) =>
      !(
        entry.purpose === "turn_rollup" &&
        entry.turnId &&
        turnsWithPerCall.has(`${entry.sessionId ?? ""}:${entry.turnId}`)
      ),
  );
}

export function summarizeModelUsage(
  workspaceDir: string,
  opts?: { sinceDays?: number; matterId?: string },
): ModelUsageSummary {
  const sinceDays = opts?.sinceDays ?? 30;
  const cutoff =
    sinceDays > 0
      ? new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  const matterFilter = opts?.matterId?.trim();

  let entries = readLedger(workspaceDir);
  if (cutoff) {
    entries = entries.filter((e) => e.recordedAt >= cutoff);
  }
  if (matterFilter) {
    entries = entries.filter((e) => e.matterId === matterFilter);
  }
  entries = dropSupersededRollupRows(entries);

  const summary: ModelUsageSummary = {
    entries: entries.length,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const byScopeMap = new Map<
    ModelBillingScope | "unknown",
    { entries: number; totalTokens: number; unknownUsageEntries: number }
  >();
  const byModelMap = new Map<string, { entries: number; totalTokens: number }>();
  const byTierMap = new Map<ModelWorkTier, { entries: number; totalTokens: number }>();
  for (const e of entries) {
    summary.promptTokens += e.promptTokens ?? 0;
    summary.completionTokens += e.completionTokens ?? 0;
    summary.totalTokens += e.totalTokens ?? 0;
    if (
      e.promptTokens === undefined ||
      e.completionTokens === undefined ||
      e.totalTokens === undefined
    ) {
      summary.unknownUsageEntries = (summary.unknownUsageEntries ?? 0) + 1;
    }
    const scope = e.billingScope ?? "unknown";
    const scopeRow = byScopeMap.get(scope) ?? {
      entries: 0,
      totalTokens: 0,
      unknownUsageEntries: 0,
    };
    scopeRow.entries += 1;
    scopeRow.totalTokens += e.totalTokens ?? 0;
    if (e.totalTokens === undefined) {
      scopeRow.unknownUsageEntries += 1;
    }
    byScopeMap.set(scope, scopeRow);
    const model = e.model?.trim() || "unknown";
    const row = byModelMap.get(model) ?? { entries: 0, totalTokens: 0 };
    row.entries += 1;
    row.totalTokens += e.totalTokens ?? 0;
    byModelMap.set(model, row);
    const tier = classifyModelWorkTier(model);
    const tierRow = byTierMap.get(tier) ?? { entries: 0, totalTokens: 0 };
    tierRow.entries += 1;
    tierRow.totalTokens += e.totalTokens ?? 0;
    byTierMap.set(tier, tierRow);
  }
  if (entries.length > 0) {
    summary.byBillingScope = [...byScopeMap].map(([billingScope, row]) => ({
      billingScope,
      ...row,
    }));
    const sorted = [...entries].toSorted((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    summary.since = sorted[0]?.recordedAt;
    summary.until = sorted[sorted.length - 1]?.recordedAt;
    summary.byModel = [...byModelMap.entries()]
      .map(([model, row]) => ({ model, entries: row.entries, totalTokens: row.totalTokens }))
      .toSorted((a, b) => b.totalTokens - a.totalTokens)
      .slice(0, 8);
    const tierOrder: ModelWorkTier[] = ["advisor", "worker", "general"];
    summary.byTier = tierOrder
      .filter((tier) => byTierMap.has(tier))
      .map((tier) => {
        const row = byTierMap.get(tier)!;
        return {
          tier,
          label: modelWorkTierLabel(tier),
          entries: row.entries,
          totalTokens: row.totalTokens,
        };
      });
  }
  return summary;
}

export function mergeUsageSnapshots(
  a: ModelUsageSnapshot | undefined,
  b: ModelUsageSnapshot | undefined,
): ModelUsageSnapshot | undefined {
  if (!a && !b) {
    return undefined;
  }
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  const promptTokens = addOptional(a.promptTokens, b.promptTokens);
  const completionTokens = addOptional(a.completionTokens, b.completionTokens);
  const totalTokens = addOptional(a.totalTokens, b.totalTokens);
  const cached = addOptional(a?.cachedTokens, b?.cachedTokens);
  const uncached = addOptional(a?.uncachedTokens, b?.uncachedTokens);
  const reasoning = addOptional(a?.reasoningTokens, b?.reasoningTokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cached !== undefined ? { cachedTokens: cached } : {}),
    ...(uncached !== undefined ? { uncachedTokens: uncached } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  };
}

/** A partial observation is not a complete cached-token total. */
function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined || b === undefined) {
    return undefined;
  }
  return a + b;
}

/**
 * 从上游 usage 取出输入/输出与**缓存命中**。
 *
 * 两代字段都读（DeepSeek 的 `prompt_cache_hit_tokens`、OpenAI 的
 * `prompt_tokens_details.cached_tokens`），取到哪个算哪个；都没有就留
 * `undefined` 表示「上游没报」，绝不当成 0 —— 0 会让「缓存没中」和
 * 「没观测」混为一谈。
 */
export function usageFromProvider(
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null,
): ModelUsageSnapshot | undefined {
  if (!usage) {
    return undefined;
  }
  const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const promptTokens = count(usage.prompt_tokens);
  const completionTokens = count(usage.completion_tokens);
  const totalTokens =
    count(usage.total_tokens) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);
  if (totalTokens === undefined && promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }
  const cachedCandidate =
    count(usage.prompt_cache_hit_tokens) ?? count(usage.prompt_tokens_details?.cached_tokens);
  const cached =
    cachedCandidate !== undefined && (promptTokens === undefined || cachedCandidate <= promptTokens)
      ? cachedCandidate
      : undefined;
  const miss = count(usage.prompt_cache_miss_tokens);
  const uncached =
    miss !== undefined && (promptTokens === undefined || miss <= promptTokens)
      ? miss
      : cached !== undefined && promptTokens !== undefined
        ? promptTokens - cached
        : undefined;
  const reasoning = count(usage.completion_tokens_details?.reasoning_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(cached !== undefined ? { cachedTokens: cached } : {}),
    ...(uncached !== undefined ? { uncachedTokens: uncached } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  };
}
