/**
 * 上下文压力的可观测口径。
 *
 * ## 为什么这个模块存在
 *
 * 修掉「模型以上下文为由把活儿退回律师」之后，必须能回答商业上真正的问题：
 * **它究竟有没有变少？整理真的腾出空间了吗？** 律师侧看到的「已整理上下文」
 * 只是系统自述做了动作，回答不了这件事——同 `material_block` 的理由：
 * **这需要数字，不是印象。**
 *
 * ## 三条不得违反的口径（与 `metrics/README.md` 一致）
 *
 * 1. **缺来源 → `present: false`，绝不产出 0。** 一个从没跑过这类路径的工作区
 *    与一个「跑了 100 轮、一次都没退让」的工作区，在报表上必须长得不一样。
 *    把前者显示成 0% 是这类报告最危险的失败模式（参照 `north-star.ts` 的
 *    「Missing samples stay null — do not invent a 0% story」）。
 * 2. **比率的分母为 0 时给 `null`，不给 0。** `deferralReachRate` 的分子与分母
 *    取自**同一来源**（都是本 kind 的事件），否则比率就不成立。
 * 3. **截断显式。** 事件窗口被截时标 `truncated` + `totalLines`，
 *    消费方不得把窗口内计数当作全量。
 *
 * ## 刻意不做的事
 *
 * - **不产出 per-turn 比率。** 「每回合整理几次」需要一个「一共多少回合」的
 *   分母，而那个分母在别的来源（session 事件日志）。跨来源相除要么扫全部会话
 *   （昂贵），要么拿「有压力事件的回合数」当分母（循环论证：分母正是分子筛出来的）。
 *   所以这里只给**计数**与**同源比率**，不给看着更漂亮的假精度。
 * - **不把「退让到达律师」当纯负面。** 反弹上限用尽后如实交回是 fail-open 的
 *   正确行为；这个数要看的是**趋势**（是否在下降），不是「必须为 0」。
 */

import {
  appendProductMetric,
  readProductMetricEvents,
  type ProductMetricEvent,
} from "./product-metrics.js";

export const CONTEXT_PRESSURE_KIND = "context_pressure";

export type ContextPressureOutcome =
  /** 工具轮边界整理成功（腾出了空间）。 */
  | "mid_turn_compact"
  /** 只缩写旧工具回包就够了，未做整段压缩。 */
  | "mid_turn_prune_only"
  /** 压了也不减（尾巴本身超窗口）→ 放弃，不把摘要堆进去。 */
  | "mid_turn_no_reduction"
  /** 本回合整理次数到上限。 */
  | "mid_turn_cap"
  /**
   * 回合内的**模型摘要**尝试（含失败/超时回落）。看 `meta.usedLlm` 与 `meta.latencyMs`：
   * 前者判断质量是否真的拿到了，后者判断它有没有拖慢对话。
   */
  | "mid_turn_llm_digest"
  /** 压不动（单条巨型消息）→ 就地中间省略腾空间（不丢消息）。 */
  | "mid_turn_elided"
  /** 识别到模型以上下文为由退让。 */
  | "deferral_detected"
  /** 已把隐藏反弹塞回下一轮采样。 */
  | "deferral_bounced"
  /** 反弹上限用尽，退让如实到达律师（fail-open；看趋势，不要求恒为 0）。 */
  | "deferral_reached_lawyer"
  /** 另起新对话（带上文）成功。 */
  | "fork_created"
  /** 另起新对话被拒（授权未决 / 回合在跑 / 源会话不存在）。 */
  | "fork_blocked";

/**
 * 记一条上下文压力事件。**绝不抛**：观测面不能拖垮律师正在办的事。
 * 与 `recordMaterialBlockEvent` 同一写法（静态 import + try/catch），
 * 不用浮动 promise —— 那会在进程收尾时静默丢事件。
 */
export function recordContextPressure(
  workspaceDir: string,
  outcome: ContextPressureOutcome,
  opts?: {
    /** 回合 id：用于「有压力的回合数」，也便于与单次退让对账。 */
    turnId?: string;
    matterId?: string;
    sessionId?: string;
    detail?: string;
    meta?: Record<string, string | number | boolean | null>;
  },
): void {
  try {
    appendProductMetric(workspaceDir, {
      kind: CONTEXT_PRESSURE_KIND,
      outcome,
      ...(opts?.turnId ? { taskId: opts.turnId } : {}),
      ...(opts?.matterId ? { matterId: opts.matterId } : {}),
      ...(opts?.detail ? { detail: opts.detail } : {}),
      meta: {
        ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
        ...opts?.meta,
      },
    });
  } catch {
    /* optional */
  }
}

export type ContextPressureSummary = {
  /** 事件源是否存在这类事件。`false` 时下面所有计数都**不可当作 0** 读。 */
  present: boolean;
  truncated: boolean;
  totalLines: number;
  windowFrom: string | null;
  windowTo: string | null;
  /** 窗口内本 kind 的事件条数。 */
  events: number;
  /** 出现过上下文压力的**不同回合**数（按 turnId 去重）。 */
  turnsWithPressure: number;
  compactions: {
    midTurn: number;
    pruneOnly: number;
    noReduction: number;
    cap: number;
    /** 压不动时靠「就地中间省略」腾出空间的次数。 */
    elided: number;
    /** 模型摘要：尝试次数、成功（真用了模型输出）次数、回落次数、P95 延迟。 */
    llmDigest: {
      attempted: number;
      used: number;
      fellBack: number;
      latencyP95Ms: number | null;
    };
  };
  deferrals: {
    detected: number;
    bounced: number;
    reachedLawyer: number;
  };
  forks: {
    created: number;
    blocked: number;
    /** 拒绝原因 → 次数（`turn_live` / `pending_authorization` / `source_not_found`）。 */
    blockedByCode: Record<string, number>;
  };
  /**
   * 退让**到达律师**的比例（`reachedLawyer / detected`）。
   * `detected === 0` → `null`（绝不产出 0）。分子分母同源，比率成立。
   */
  deferralReachRate: number | null;
  /**
   * 整理了**且真腾出空间**的比例（`midTurn / (midTurn + noReduction)`）。
   * 分母为 0 → `null`。这张告诉运维「no_reduction 是不是长期偏高」。
   */
  compactionEffectiveness: number | null;
};

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function isContextPressureEvent(event: ProductMetricEvent): boolean {
  return event.kind === CONTEXT_PRESSURE_KIND;
}

export function summarizeContextPressure(
  workspaceDir: string,
  limit = 5000,
): ContextPressureSummary {
  const page = readProductMetricEvents(workspaceDir, limit);
  const rows = page.events.filter(isContextPressureEvent);
  const summary: ContextPressureSummary = {
    present: rows.length > 0,
    truncated: page.truncated,
    totalLines: page.totalLines,
    windowFrom: page.windowFrom,
    windowTo: page.windowTo,
    events: rows.length,
    turnsWithPressure: 0,
    compactions: {
      midTurn: 0,
      pruneOnly: 0,
      noReduction: 0,
      cap: 0,
      elided: 0,
      llmDigest: { attempted: 0, used: 0, fellBack: 0, latencyP95Ms: null },
    },
    deferrals: { detected: 0, bounced: 0, reachedLawyer: 0 },
    forks: { created: 0, blocked: 0, blockedByCode: {} },
    deferralReachRate: null,
    compactionEffectiveness: null,
  };

  const turns = new Set<string>();
  /** 模型摘要延迟样本，用于 P95（不问「平均」——被极端值拖住的平均数会掩盖卡顿）。 */
  const llmDigestLatencies: number[] = [];
  for (const row of rows) {
    const turnId = typeof row.taskId === "string" ? row.taskId.trim() : "";
    if (turnId) {
      turns.add(turnId);
    }
    switch (row.outcome as ContextPressureOutcome) {
      case "mid_turn_compact":
        summary.compactions.midTurn += 1;
        break;
      case "mid_turn_prune_only":
        summary.compactions.pruneOnly += 1;
        break;
      case "mid_turn_no_reduction":
        summary.compactions.noReduction += 1;
        break;
      case "mid_turn_cap":
        summary.compactions.cap += 1;
        break;
      case "mid_turn_elided":
        summary.compactions.elided += 1;
        break;
      case "mid_turn_llm_digest": {
        summary.compactions.llmDigest.attempted += 1;
        if (row.meta?.usedLlm === true) {
          summary.compactions.llmDigest.used += 1;
        } else {
          summary.compactions.llmDigest.fellBack += 1;
        }
        const latency = row.meta?.latencyMs;
        if (typeof latency === "number" && Number.isFinite(latency) && latency >= 0) {
          llmDigestLatencies.push(latency);
        }
        break;
      }
      case "deferral_detected":
        summary.deferrals.detected += 1;
        break;
      case "deferral_bounced":
        summary.deferrals.bounced += 1;
        break;
      case "deferral_reached_lawyer":
        summary.deferrals.reachedLawyer += 1;
        break;
      case "fork_created":
        summary.forks.created += 1;
        break;
      case "fork_blocked": {
        summary.forks.blocked += 1;
        // 拒绝原因写在 meta.code（`session-carryover.ts` 的 ForkBlockedCode）。
        const code = typeof row.meta?.code === "string" ? row.meta.code : "unknown";
        summary.forks.blockedByCode[code] = (summary.forks.blockedByCode[code] ?? 0) + 1;
        break;
      }
      default:
        break;
    }
  }

  summary.turnsWithPressure = turns.size;
  if (llmDigestLatencies.length > 0) {
    const sorted = [...llmDigestLatencies].toSorted((a, b) => a - b);
    summary.compactions.llmDigest.latencyP95Ms =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? null;
  }
  summary.deferralReachRate = ratio(summary.deferrals.reachedLawyer, summary.deferrals.detected);
  const attempted = summary.compactions.midTurn + summary.compactions.noReduction;
  summary.compactionEffectiveness = ratio(summary.compactions.midTurn, attempted);
  return summary;
}
