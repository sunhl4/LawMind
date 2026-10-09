/**
 * Tool rounds use the model's own output budget. A 4096 cap is spent on
 * DeepSeek `reasoning_content` before the tool call is written.
 * A later raise only happens when this function sent less than `configured`.
 */

export const TOOL_DECISION_MAX_TOKENS = 4_096;

export function resolveToolDecisionMaxTokens(
  configured: number | undefined,
  _toolsAdvertised: boolean,
): number | undefined {
  if (configured == null || !Number.isFinite(configured) || configured <= 0) {
    return undefined;
  }
  return Math.floor(configured);
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
  const sent = resolveToolDecisionMaxTokens(configured, true);
  return sent != null && sent < Math.floor(configured);
}
