/**
 * Tool-decision rounds ask for a short completion. The full envelope is only
 * used when that short completion comes back truncated (the model is writing
 * the deliverable in the reply, not picking the next tool).
 */

export const TOOL_DECISION_MAX_TOKENS = 4_096;

export function resolveToolDecisionMaxTokens(
  configured: number | undefined,
  toolsAdvertised: boolean,
): number | undefined {
  if (!toolsAdvertised) {
    return configured && configured > 0 ? Math.floor(configured) : undefined;
  }
  if (configured == null || !Number.isFinite(configured) || configured <= 0) {
    return TOOL_DECISION_MAX_TOKENS;
  }
  return Math.min(Math.floor(configured), TOOL_DECISION_MAX_TOKENS);
}

export function shouldRaiseToolDecisionOutput(opts: {
  toolsAdvertised: boolean;
  configuredMaxTokens?: number;
  finishReason?: string | null;
}): boolean {
  if (!opts.toolsAdvertised) {
    return false;
  }
  if ((opts.finishReason ?? "").toLowerCase() !== "length") {
    return false;
  }
  const configured = opts.configuredMaxTokens;
  if (configured == null || !Number.isFinite(configured) || configured <= 0) {
    return true;
  }
  return configured > TOOL_DECISION_MAX_TOKENS;
}
