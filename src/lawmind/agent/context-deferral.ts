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

/** 同一回合最多反弹几次；超出后如实收下模型的最终回复（fail-open）。 */
export const CONTEXT_DEFERRAL_BOUNCE_MAX = 2;

/**
 * 必须同时命中「上下文水位」与「把活儿推回给律师」两类词才算退让。
 * 只命中其一（例如法律正文里的「案件预算分次支付」）不得误判。
 */
const CONTEXT_WATERLINE_RE =
  /上下文|(?:上下文|模型|对话|会话)?窗口|token|字数|篇幅|本条(?:消息|指令)过(?:长|大)/i;

const HAND_BACK_RE =
  /另(?:开|起)(?:一)?轮|新(?:的)?会话|重开(?:会话|对话)|换个?(?:会话|对话)|分次(?:交办|给|发|办理)|下一轮再|下次再(?:给|发|做)|请重新(?:发起|发送|提问)/;

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
