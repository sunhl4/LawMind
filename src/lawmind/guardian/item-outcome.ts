/**
 * 逐项判定结果落盘（G2）——把「哪一项、由谁判、判了什么」变成可累积的数据。
 *
 * 为什么必须落盘：
 * `delivery/judgement-ratchet.ts` 已经实现了「测量换信任」的升级判据
 * （`isJudgementItemPromotable` / `deriveJudgementItemSeries`），但它**没有任何生产调用方**
 * ——因为它的输入 `firedByTask` 无人产出。同时 `aggregateGuardianItems` 算出的
 * `itemVerdicts` 只存在于内存，`GuardianRecord` 里并没有它，跑完就丢。
 *
 * 结果是：棘轮建好了、判级也落地了，但**没有任何数据能流进棘轮**。
 * 本模块补的就是这一段。
 *
 * 三条口径（与 `metrics/decision-samples.ts` 一致，不得违反）：
 *   1. 缺数据 → `present: false`，**绝不编 0**；
 *   2. 坏行 / 半写行静默跳过但**计数**，不抛；
 *   3. `buildXxx` 纯函数、`appendXxx` 单独写盘——读与写不混在一条路径里。
 */

import fs from "node:fs";
import path from "node:path";
import type { JudgmentTier } from "./judgment-tier.js";

export const GUARDIAN_ITEM_OUTCOMES_REL = "lawmind/decision/guardian-item-outcomes.jsonl";

export type GuardianItemDecidedBy = "machine" | "model" | "lawyer";

export type GuardianItemOutcome = {
  ts: string;
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  familyId?: string;
  /** **判定表键**（word-revision 为条项 id；verification 为 `<specId>/<itemId>`）。 */
  itemKey: string;
  tier: JudgmentTier;
  decidedBy: GuardianItemDecidedBy;
  /** `null` 表示该项本次**没有结论**（lawyer 项、或未回答）。不要用 `false` 冒充。 */
  supported: boolean | null;
  /** machine 与 model 结论相反（shadow 期才有）——转 `on` 的直接依据。 */
  conflict?: boolean;
  /** 验证器不可用（fail-closed 已判定，但需要计入不可用率 SLO）。 */
  unavailable?: boolean;
};

/** 判定表键的大小写/空白归一，防止同一项因书写差异被算成两条序列。 */
function normalizeKey(key: string): string {
  return key.trim();
}

export function guardianItemOutcomesPath(workspaceDir: string): string {
  return path.join(workspaceDir, GUARDIAN_ITEM_OUTCOMES_REL);
}

/**
 * 追加落盘。**永不抛**——落盘失败不得影响审稿结论。
 *
 * 返回实际写入的行数（0 表示没写或写失败），供调用方观测。
 */
export function appendGuardianItemOutcomes(
  workspaceDir: string,
  outcomes: readonly GuardianItemOutcome[],
): number {
  const rows = outcomes.filter((o) => normalizeKey(o.itemKey).length > 0);
  if (rows.length === 0) {
    return 0;
  }
  try {
    const dest = guardianItemOutcomesPath(workspaceDir);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.appendFileSync(dest, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
    return rows.length;
  } catch {
    return 0;
  }
}

export type GuardianItemOutcomeReadResult = {
  present: boolean;
  rows: GuardianItemOutcome[];
  totalLines: number;
  skippedLines: number;
};

const TIERS = new Set<string>(["machine", "judge", "lawyer"]);
const DECIDERS = new Set<string>(["machine", "model", "lawyer"]);

function isOutcomeRecord(value: unknown): value is GuardianItemOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.ts !== "string" || !rec.ts.trim()) {
    return false;
  }
  if (typeof rec.taskId !== "string" || !rec.taskId.trim()) {
    return false;
  }
  if (typeof rec.itemKey !== "string" || !rec.itemKey.trim()) {
    return false;
  }
  if (typeof rec.tier !== "string" || !TIERS.has(rec.tier)) {
    return false;
  }
  if (typeof rec.decidedBy !== "string" || !DECIDERS.has(rec.decidedBy)) {
    return false;
  }
  // supported 必须是布尔或 null；其它类型说明写坏了。
  return rec.supported === null || typeof rec.supported === "boolean";
}

/** 容错读取：坏行跳过并计数，文件不存在返回 `present: false`（不抛、不编 0）。 */
export function readGuardianItemOutcomes(workspaceDir: string): GuardianItemOutcomeReadResult {
  const file = guardianItemOutcomesPath(workspaceDir);
  if (!fs.existsSync(file)) {
    return { present: false, rows: [], totalLines: 0, skippedLines: 0 };
  }
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { present: false, rows: [], totalLines: 0, skippedLines: 0 };
  }
  const rows: GuardianItemOutcome[] = [];
  let totalLines = 0;
  let skippedLines = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    totalLines += 1;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isOutcomeRecord(parsed)) {
        rows.push({ ...parsed, itemKey: normalizeKey(parsed.itemKey) });
      } else {
        skippedLines += 1;
      }
    } catch {
      skippedLines += 1;
    }
  }
  return { present: true, rows, totalLines, skippedLines };
}

/**
 * 按任务聚合，喂给 `deriveJudgementItemSeries` 的 `firedByTask`。
 *
 * **「报项」的定义**：该项本次**判未覆盖**（`supported === false` 且非 `unavailable`）。
 *
 * ⚠️ **`cleanDelivery` 必须来自外生信号，本函数绝不自己推导。**
 *
 * 这里踩过一个**严重的坑**（2026-09-21 由测试发现）：最初的实现把 `cleanDelivery`
 * 定义成「本任务没有任何项报项」。但 `deriveJudgementItemSeries` 只在
 * 「本任务**恰好一项**报项 **且** cleanDelivery」时才计入 `firedClean`——
 * 而那时该任务必然有项报项，于是 `cleanDelivery` 恒为 false、`firedClean` 恒为 0、
 * 误报率恒为 0。**后果是：只要样本量够、顾问已验收，每一项都会被判可升 blocking**
 * ——把「从未观测到误报」当成「没有误报」，正是本仓反复警告的失败模式。
 *
 * 所以这里改成：**只有调用方给出该任务的干净交付信号时才产出记录**。
 * 信号来自交付侧（律师是否实质改动 / 是否驳回），见计划 §4.2 的
 * `UnescalatedDeliveryEvent`。信号缺失的任务**整条不产出**——
 * 宁可让棘轮没有数据（= 不升级），也不要给它假数据（= 乱升级）。
 */
export function deriveFiredByTask(
  workspaceDir: string,
  opts?: {
    /**
     * 外生「干净交付」信号：taskId → 律师交付后**没有**实质改动。
     *
     * **必须**来自交付侧记录（`approvals.jsonl` / `lawyer_edit` 事件），
     * **不得**从本模块的审稿结论推导（那会构成循环论证，见上）。
     * 缺省的 `Map` 表示信号尚未接通——此时返回 `[]`，这是**正确**行为。
     */
    cleanDeliveryByTask?: ReadonlyMap<string, boolean>;
  },
): Array<{ taskId: string; itemIds: string[]; cleanDelivery: boolean }> {
  const known = opts?.cleanDeliveryByTask;
  if (!known || known.size === 0) {
    return [];
  }
  const read = readGuardianItemOutcomes(workspaceDir);
  if (!read.present) {
    return [];
  }
  const byTask = new Map<string, Set<string>>();
  for (const row of read.rows) {
    // 只有明确判未覆盖才算报项；`null`（无结论）与 `unavailable` 都不算——
    // 把"没判出来"当成"报了问题"会污染误报率。
    if (row.supported !== false || row.unavailable === true) {
      continue;
    }
    const set = byTask.get(row.taskId) ?? new Set<string>();
    set.add(row.itemKey);
    byTask.set(row.taskId, set);
  }
  const out: Array<{ taskId: string; itemIds: string[]; cleanDelivery: boolean }> = [];
  for (const [taskId, fired] of byTask) {
    const clean = known.get(taskId);
    // 没有外生信号的任务不产出——宁缺勿假。
    if (clean === undefined) {
      continue;
    }
    out.push({ taskId, itemIds: [...fired].toSorted(), cleanDelivery: clean });
  }
  return out.toSorted((a, b) => a.taskId.localeCompare(b.taskId));
}

/**
 * 有多少任务「报了项、但缺外生干净交付信号」。
 *
 * 这个数字必须可见：否则「棘轮没有可升级项」会被误读成「规则质量还不够好」，
 * 而真相可能是**信号通路根本没接通**。Doctor 应直接显示它。
 */
export function countTasksAwaitingExternalSignal(workspaceDir: string): number {
  const read = readGuardianItemOutcomes(workspaceDir);
  if (!read.present) {
    return 0;
  }
  const fired = new Set<string>();
  for (const row of read.rows) {
    if (row.supported === false && row.unavailable !== true) {
      fired.add(row.taskId);
    }
  }
  return fired.size;
}

/** 供 Doctor / 报告：逐项计数（按项聚合，不跨任务去重）。 */
export function summarizeGuardianItemOutcomes(workspaceDir: string): {
  present: boolean;
  total: number;
  skippedLines: number;
  byItem: Array<{
    itemKey: string;
    tier: JudgmentTier;
    samples: number;
    notCovered: number;
    unavailable: number;
    conflicts: number;
    /** 有结论的样本数——分母只算有结论的，避免把"没判出来"当成分母。 */
    decided: number;
    notCoveredRate: number | null;
  }>;
} {
  const read = readGuardianItemOutcomes(workspaceDir);
  if (!read.present) {
    return { present: false, total: 0, skippedLines: 0, byItem: [] };
  }
  const acc = new Map<
    string,
    {
      tier: JudgmentTier;
      samples: number;
      notCovered: number;
      unavailable: number;
      conflicts: number;
      decided: number;
    }
  >();
  for (const row of read.rows) {
    const entry = acc.get(row.itemKey) ?? {
      tier: row.tier,
      samples: 0,
      notCovered: 0,
      unavailable: 0,
      conflicts: 0,
      decided: 0,
    };
    entry.samples += 1;
    if (row.unavailable === true) {
      entry.unavailable += 1;
    }
    if (row.supported !== null) {
      entry.decided += 1;
      if (!row.supported && row.unavailable !== true) {
        entry.notCovered += 1;
      }
    }
    if (row.conflict === true) {
      entry.conflicts += 1;
    }
    acc.set(row.itemKey, entry);
  }
  return {
    present: true,
    total: read.rows.length,
    skippedLines: read.skippedLines,
    byItem: [...acc.entries()]
      .map(([itemKey, v]) => ({
        itemKey,
        tier: v.tier,
        samples: v.samples,
        notCovered: v.notCovered,
        unavailable: v.unavailable,
        conflicts: v.conflicts,
        decided: v.decided,
        // 没有已决样本时是 `null`，不是 0——不编「0% 未覆盖」的故事。
        notCoveredRate: v.decided === 0 ? null : v.notCovered / v.decided,
      }))
      .toSorted((a, b) => a.itemKey.localeCompare(b.itemKey)),
  };
}
