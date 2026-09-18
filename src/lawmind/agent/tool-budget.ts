import { DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN } from "../policy/workspace-policy.js";

/**
 * Tool-call budget: silent working ceiling vs runaway hard stop.
 *
 * Step count is not a lawyer decision. Keep working until the model delivers,
 * or until the hard ceiling (anti-runaway). Ask the lawyer only for outbound
 * send, original-file mutation, and other true authorization gates.
 */

export const DEFAULT_SOFT_TOOL_CALLS = DEFAULT_AGENT_MAX_TOOL_CALLS_PER_TURN;
export const DEFAULT_HARD_TOOL_CALL_CEILING = 80;

export type ToolCallBudgets = {
  soft: number;
  hard: number;
};

export function resolveToolCallBudgets(maxToolCalls?: number): ToolCallBudgets {
  const cap =
    typeof maxToolCalls === "number" && Number.isFinite(maxToolCalls) && maxToolCalls > 0
      ? Math.floor(maxToolCalls)
      : DEFAULT_SOFT_TOOL_CALLS;
  // Tiny delegation shards (parent remaining floor is 1) must stop at the
  // assigned cap and report to the parent agent — not the lawyer, and not by
  // stretching to the 80-step runaway ceiling. Default-scale turns get the
  // hard ceiling so a 50-step review can finish without a mid-turn interrupt.
  const hard = cap < 8 ? cap : Math.max(cap, DEFAULT_HARD_TOOL_CALL_CEILING);
  return { soft: cap, hard };
}

export function shouldCheckpointToolBudget(_opts: {
  used: number;
  soft: number;
  skipCheckpoint?: boolean;
}): boolean {
  return false;
}

export function shouldHardStopToolBudget(used: number, hard: number): boolean {
  return used >= hard;
}

/** Kept for already-paused continue_tools cards; new turns never emit this. */
export function formatToolBudgetContinueReply(used: number): string {
  return `本轮已办理 ${used} 步。继续，还是先停在这里？未完成的交付不会外发。`;
}

export function formatToolBudgetHardStopReply(): string {
  return "已达到本轮办理上限，先停在这里以防空转。需要时在对话里接着办。";
}
