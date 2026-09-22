/**
 * 未升级交付的外生验收信号（G2 关键缺口修复）。
 *
 * ## 为什么需要这个模块
 *
 * `delivery/judgement-ratchet.ts` 的「测量换信任」判据需要两样输入：
 *   1. 该项**报过**几次（谁的报项）—— `guardian/item-outcome.ts` 已产出；
 *   2. 报过的那几次里，**律师最后认可了吗**——**本模块产出**。
 *
 * 第 2 项曾一度被我写成「本任务没有任何项报项」——那是**错的**，而且非常危险：
 * 棘轮只在「恰好一项报项 **且** cleanDelivery」时才计入误报，两个条件互斥，
 * 于是 `firedClean` 恒为 0、误报率恒为 0，**每一项都会被判可升 blocking**。
 * 详见 `LAWMIND-DECISION-LAYER-PRODUCTION-PLAN.md` §4.1b。
 *
 * ## 外生性是硬要求（SEAL 原理）
 *
 * `Self-Authored Verification Is Unreliable`（arXiv 2607.24300）的结论：
 * 可靠自改进**需要一个 agent 无法控制、无法观察的接受/拒绝信号**。
 * 落地到本仓意味着：
 *
 * > **批准必须来自律师**。系统自动交付写下的 `reviewStatus="approved"`
 * > （`reviewedBy` 以 `system:` 开头）**不算验收信号**——那是判定器给自己判卷。
 *
 * ## 三态，不是布尔
 *
 * `humanAcceptance` 有 `"unknown"` 一档，且**必须**存在：
 * 律师还没审核时，我们**不知道**他会不会改。把它当成「不干净」会让每一项
 * 都被记成真报项（误报率虚低 → 乱升级）；把它当成「干净」则相反。
 * 所以：**信号未到的任务整条不产出**——宁可让棘轮没数据（= 不升级），
 * 也不给它假数据（= 乱升级）。
 */

import {
  deriveJudgementItemSeries,
  resolvePromotableJudgementItems,
  type JudgementItemSeries,
  type JudgementPromotionThresholds,
} from "../delivery/judgement-ratchet.js";
import {
  deriveFiredByTask,
  type GuardianItemOutcome,
  type GuardianItemOutcomeReadResult,
} from "../guardian/item-outcome.js";
import {
  listRuntimeEvents,
  type DeliverHumanAcceptance,
  type DeliverInterruptionReason,
  type RuntimeEvent,
} from "./runtime-events.js";

/** 一条交付的「为什么没打断律师」记录（从 runtime-events 折出）。 */
export type UnescalatedDeliveryRecord = {
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  ts: string;
  interruptionReason: DeliverInterruptionReason;
  humanAcceptance: DeliverHumanAcceptance;
};

function asInterruptionReason(v: unknown): DeliverInterruptionReason {
  return v === "all_gates_green" || v === "advisory_only" || v === "escalation_disabled"
    ? v
    : "unknown";
}

function asHumanAcceptance(v: unknown): DeliverHumanAcceptance {
  return v === "accepted_clean" || v === "accepted_with_change" ? v : "unknown";
}

/** 读交付事件（按时间升序）。缺字段一律落 `"unknown"`——不猜。 */
export function listUnescalatedDeliveries(
  workspaceDir: string,
  limit = 5000,
): UnescalatedDeliveryRecord[] {
  const events: RuntimeEvent[] = listRuntimeEvents(workspaceDir, limit);
  const out: UnescalatedDeliveryRecord[] = [];
  for (const ev of events) {
    if (ev.kind !== "deliver") {
      continue;
    }
    const taskId = ev.taskId?.trim();
    if (!taskId) {
      // 没有 taskId 的交付无法与逐项结果对齐——跳过而不是编一个键。
      continue;
    }
    out.push({
      taskId,
      ...(ev.matterId ? { matterId: ev.matterId } : {}),
      ...(ev.deliverableType ? { deliverableType: ev.deliverableType } : {}),
      ts: ev.ts,
      interruptionReason: asInterruptionReason(ev.meta?.interruptionReason),
      humanAcceptance: asHumanAcceptance(ev.meta?.humanAcceptance),
    });
  }
  return out;
}

/**
 * 折出 `deriveFiredByTask` 需要的 `cleanDeliveryByTask`。
 *
 * **只产出有决定性信号的任务**：
 *   - 每个任务取**最后一条**交付事件（后面的覆盖前面的：律师可能先审后退）；
 *   - `accepted_clean` → `true`（该项是误报）；
 *   - `accepted_with_change` → `false`（真报项）；
 *   - `unknown` → **该任务不出现**（信号未到，明缺勿假）。
 */
export function deriveCleanDeliveryByTask(workspaceDir: string): Map<string, boolean> {
  const lastByTask = new Map<string, UnescalatedDeliveryRecord>();
  for (const row of listUnescalatedDeliveries(workspaceDir)) {
    const prev = lastByTask.get(row.taskId);
    // 事件按时间升序，后写覆盖先写。
    if (!prev || row.ts >= prev.ts) {
      lastByTask.set(row.taskId, row);
    }
  }
  const out = new Map<string, boolean>();
  for (const [taskId, row] of lastByTask) {
    if (row.humanAcceptance === "accepted_clean") {
      out.set(taskId, true);
    } else if (row.humanAcceptance === "accepted_with_change") {
      out.set(taskId, false);
    }
    // unknown → 不产出。
  }
  return out;
}

/**
 * 外生信号的覆盖体检。
 *
 * 这个报告回答一个问题：**「棘轮拿不到数据，是因为规则质量不够，还是因为信号没接通？」**
 * 两者在 Doctor 上看起来一样（都表现为"没有可升级项"），但处置完全不同——
 * 前者要继续攒样本，后者要先修通路。
 */
export type ExternalSignalCoverage = {
  /** 有交付事件的任务数。 */
  deliveredTasks: number;
  /** 其中做出了决定性验收判断的任务数。 */
  decidedTasks: number;
  /** 信号仍是 `unknown` 的任务数（= 棘轮看不到的任务）。 */
  unknownTasks: number;
  /** 「未知」的原因分布——用于定位到底缺哪一环。 */
  unknownReasons: Array<{ interruptionReason: DeliverInterruptionReason; count: number }>;
  /** 0 表示棘轮完全没有输入；`null` 表示连交付事件都没有。 */
  decidedRatio: number | null;
};

export function summarizeExternalSignalCoverage(
  workspaceDir: string,
  opts?: { outcomeRead?: GuardianItemOutcomeReadResult },
): ExternalSignalCoverage {
  const deliveries = listUnescalatedDeliveries(workspaceDir);
  const taskIds = new Set(deliveries.map((d) => d.taskId));
  // 只看「报过项的」任务——没报过项的任务对棘轮没有意义。
  const fired = new Set(
    (opts?.outcomeRead?.rows ?? [])
      .filter((r: GuardianItemOutcome) => r.supported === false && r.unavailable !== true)
      .map((r) => r.taskId),
  );
  const relevant = [...taskIds].filter((id) => fired.size === 0 || fired.has(id));

  const lastByTask = new Map<string, UnescalatedDeliveryRecord>();
  for (const row of deliveries) {
    const prev = lastByTask.get(row.taskId);
    if (!prev || row.ts >= prev.ts) {
      lastByTask.set(row.taskId, row);
    }
  }
  let decided = 0;
  const reasonCounts = new Map<DeliverInterruptionReason, number>();
  for (const id of relevant) {
    const row = lastByTask.get(id);
    if (!row) {
      continue;
    }
    if (row.humanAcceptance === "unknown") {
      reasonCounts.set(row.interruptionReason, (reasonCounts.get(row.interruptionReason) ?? 0) + 1);
    } else {
      decided += 1;
    }
  }
  return {
    deliveredTasks: relevant.length,
    decidedTasks: decided,
    unknownTasks: relevant.length - decided,
    unknownReasons: [...reasonCounts.entries()]
      .map(([interruptionReason, count]) => ({ interruptionReason, count }))
      .toSorted(
        (a, b) => b.count - a.count || a.interruptionReason.localeCompare(b.interruptionReason),
      ),
    decidedRatio: relevant.length === 0 ? null : decided / relevant.length,
  };
}

/**
 * 端到端组装：一次调用把棘轮需要的全部输入备齐。
 *
 * 这是**唯一**推荐的喂法——把 `cleanDeliveryByTask` 与 `deriveFiredByTask` 绑在一起，
 * 避免调用方漏传外生信号（那正是 §4.1b 那个缺陷的成因）。
 *
 * `missedAndEditedCount` 与 `advisorAcceptedItemIds` 仍需调用方给出：
 * 前者来自 lint 逃逸语料（P0 已建），后者来自法律顾问验收工件（§11）。
 */
export function collectJudgementSeriesInput(
  workspaceDir: string,
  input: {
    missedAndEditedCount: number | null;
    advisorAcceptedItemIds: ReadonlySet<string>;
  },
): {
  series: JudgementItemSeries[];
  coverage: ExternalSignalCoverage;
} {
  const cleanDeliveryByTask = deriveCleanDeliveryByTask(workspaceDir);
  const firedByTask = deriveFiredByTask(workspaceDir, { cleanDeliveryByTask });
  const series = deriveJudgementItemSeries({
    firedByTask,
    missedAndEditedCount: input.missedAndEditedCount,
    advisorAcceptedItemIds: input.advisorAcceptedItemIds,
  });
  return { series, coverage: summarizeExternalSignalCoverage(workspaceDir) };
}

/** 便捷：直接拿可升级项（只给判决，**不改任何门禁**）。 */
export function collectPromotableJudgementItems(
  workspaceDir: string,
  input: {
    missedAndEditedCount: number | null;
    advisorAcceptedItemIds: ReadonlySet<string>;
    thresholds?: JudgementPromotionThresholds;
  },
): ReturnType<typeof resolvePromotableJudgementItems> & { coverage: ExternalSignalCoverage } {
  const { series, coverage } = collectJudgementSeriesInput(workspaceDir, input);
  return { ...resolvePromotableJudgementItems(series, input.thresholds), coverage };
}
