/**
 * Tool-call budget: soft checkpoint vs hard runaway ceiling.
 * Soft = ask the lawyer whether to continue. Hard = stop the loop.
 */

export const DEFAULT_SOFT_TOOL_CALLS = 40;
export const DEFAULT_HARD_TOOL_CALL_CEILING = 80;

export type ToolCallBudgets = {
  soft: number;
  hard: number;
};

export function resolveToolCallBudgets(maxToolCalls?: number): ToolCallBudgets {
  const soft =
    typeof maxToolCalls === "number" && Number.isFinite(maxToolCalls) && maxToolCalls > 0
      ? Math.floor(maxToolCalls)
      : DEFAULT_SOFT_TOOL_CALLS;
  const hard = Math.max(soft * 2, DEFAULT_HARD_TOOL_CALL_CEILING);
  return { soft, hard };
}

export function shouldCheckpointToolBudget(opts: {
  used: number;
  soft: number;
  skipCheckpoint?: boolean;
}): boolean {
  if (opts.skipCheckpoint) {
    return false;
  }
  return opts.used >= opts.soft;
}

export function shouldHardStopToolBudget(used: number, hard: number): boolean {
  return used >= hard;
}

export function formatToolBudgetContinueReply(used: number): string {
  return `本轮已办理 ${used} 步。继续，还是先停在这里？未完成的交付不会外发。`;
}

export function formatToolBudgetHardStopReply(): string {
  return "已达到本轮办理上限，先停在这里以防空转。需要时在对话里接着办，或改用「自动办件」短路径。";
}
