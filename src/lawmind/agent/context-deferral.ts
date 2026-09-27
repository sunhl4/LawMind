/**
 * Context-budget deferral guard.
 *
 * 客户事故：回合内上下文接近上限时，模型会写「本轮上下文预算已接近上限……请另开一轮」，
 * 把活儿退回给律师。Codex 在工具循环边界自动压缩后**继续本回合**，Cursor 用
 * self-summarization 续跑，两者都不要求用户重开会话；LawMind 的窗口水位也不该是
 * 停下的理由（见 `mid-turn-compact.ts`）。
 *
 * 本模块只做两件事：
 *   1. 识别「以上下文预算为由把活儿退回律师」的收尾文案；
 *   2. 生成一条隐藏的**反弹**消息塞回下一轮采样，让模型在同一回合里接着办。
 *
 * 硬性契约：反弹消息是给模型看的（`hiddenFromLawyer`），不进律师气泡；跑完由
 * {@link dropContextDeferralBounces} 清掉，不留长期痕迹。
 */

import type { AgentMessage } from "./types.js";

/** 反弹消息的前缀 / 断言标记。也进 `COMPACT_SYNTHETIC_USER_MARKERS`（压缩可整条丢弃）。 */
export const CONTEXT_DEFERRAL_BOUNCE_MARKER = "【上下文预算】";

/**
 * 同一回合最多反弹几次；超出后如实收下模型的最终回复（fail-open）。
 * 默认见 `context-tuning.ts`（policy `context.midTurn.deferralBounceMax`）。
 */
export { CONTEXT_DEFERRAL_BOUNCE_MAX } from "./context-tuning.js";

/**
 * 必须同时命中「上下文水位」与「把活儿推回给律师」两类词才算退让。
 * 只命中其一（例如法律正文里的「案件预算分次支付」）不得误判。
 *
 * 两类词都要放宽到**真实变体**：早期只认「另开一轮」等少数说法，
 * 于是「内容过多，建议分两次处理」「为避免过长，下次继续」这类照样溜到律师面前
 * （见 `metrics/context-pressure.ts` 的 `deferral_reached_lawyer` 趋势）。
 * 放宽的代价用「必须两类同时命中」抵消——单类命中一律不算。
 */
const CONTEXT_WATERLINE_RE =
  /上下文|(?:上下文|模型|对话|会话|本条)?窗口|token|字数|篇幅|内容(?:过|太|较)?(?:多|长|大)|信息量(?:过|太|较)?大|材料(?:过|太|较)?多|本条(?:消息|指令|任务)/i;

const HAND_BACK_RE =
  /另(?:开|起)(?:一)?轮|新(?:的)?会话|重开(?:会话|对话)|换个?(?:会话|对话)|分次(?:交办|给|发|办理|完成)|分(?:两|多)次(?:处理|交办|办理|完成|发送|提问|对话|进行)|分批(?:交办|处理|给|发|完成)|拆(?:段|批)|下一轮再|下次(?:再)?(?:给|发|做|继续)|本次先到这里|先到这里|请重新(?:发起|发送|提问)|(?:改|换)(?:个|一)?(?:时间|时候)再|建议(?:分|拆)(?:批|段)|逐(?:段|批)(?:处理|交办)/;

export function isContextBudgetDeferralReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 8) {
    return false;
  }
  return CONTEXT_WATERLINE_RE.test(trimmed) && HAND_BACK_RE.test(trimmed);
}

export function formatContextDeferralBounce(): string {
  return [
    `${CONTEXT_DEFERRAL_BOUNCE_MARKER}上下文水位不是停下或把活儿退回律师的理由。`,
    "- 运行时会在工具轮边界自动整理上下文并继续本回合；上方【窗口】行是事实通报，不是让你收工的指令。",
    "- 不得在回复里请律师「另开一轮」「重开会话」「分次交办」或改日再办，也不得用「上下文不足」解释未完成。",
    "- 继续调用工具办到交付；已完成的结论与进度落到草稿 / 案件文件（在办），压缩后仍可复读。",
  ].join("\n");
}

/**
 * 反弹用尽后的**诚实结构化交接**。
 *
 * 为什么不直接把模型那句推诿原样交给律师：那句是模型的内部状态叙述
 * （「预算已接近上限，请另开一轮」），对律师既无信息量、又把系统该承担的事
 * 推给了人。这里只写**可核对的事实**（本轮做了多少、清单剩什么、整理过几次），
 * 并明确给出正确的继续方式（「另起新对话（带上文）」）——不假装完成，也不编进度。
 */
export function formatContextDeferralHandoff(opts: {
  toolCallsExecuted: number;
  /** 本轮清单里未完成/进行中的项（来自 `update_plan`，耐久、压缩后仍在）。 */
  planOpen?: readonly string[];
  /** 本会话已整理上下文次数（来自指标事件，0 表示没压过）。 */
  compactCount?: number;
}): string {
  const lines: string[] = [
    "【本轮因上下文压力停下】引擎已尽力整理并让它继续，但它仍把这轮退回重来——照实说明，不替它掩饰。",
    "",
    `- 本轮已执行 ${opts.toolCallsExecuted} 次工具调用。`,
  ];
  const open = (opts.planOpen ?? []).map((s) => s.trim()).filter(Boolean);
  if (open.length > 0) {
    lines.push(`- 清单未完成：${open.slice(0, 8).join("；")}${open.length > 8 ? " 等" : ""}。`);
  } else {
    lines.push("- 本轮没有留下可核对的清单（未写工作任务书）。");
  }
  if (typeof opts.compactCount === "number" && opts.compactCount > 0) {
    lines.push(`- 这段对话已整理过 ${opts.compactCount} 次上下文。`);
  }
  lines.push(
    "- 草稿、案件档案与待办都留在原处，不受影响；已写下的结论不需要重讲。",
    "",
    "**继续方式**：点输入框下方的「上下文用量」→「另起新对话（带上文）」。" +
      "它会把这段对话的整理稿带进新对话，你接着说一句即可，不必重述来龙去脉。",
  );
  return lines.join("\n");
}

export function isContextDeferralBounceMessage(
  msg: Pick<AgentMessage, "role" | "content" | "hiddenFromLawyer">,
): boolean {
  return (
    msg.role === "user" &&
    msg.hiddenFromLawyer === true &&
    (msg.content ?? "").startsWith(CONTEXT_DEFERRAL_BOUNCE_MARKER)
  );
}

/** 收口清理：反弹消息只服务下一轮采样，不留进长期历史。 */
export function dropContextDeferralBounces<
  T extends Pick<AgentMessage, "role" | "content" | "hiddenFromLawyer">,
>(messages: T[]): T[] {
  return messages.filter((msg) => !isContextDeferralBounceMessage(msg));
}
