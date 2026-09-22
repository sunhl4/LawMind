/**
 * Heuristic Worker / Advisor labels for local usage display.
 * Not a billing system — no dollar costs.
 */

export type ModelWorkTier = "advisor" | "worker" | "general";

/** Classify upstream model name (or catalog id) into a work tier. */
export function classifyModelWorkTier(modelName: string): ModelWorkTier {
  const m = modelName.trim().toLowerCase();
  if (!m || m === "unknown") {
    return "general";
  }
  if (
    /(?:^|[^a-z])o1(?:[^a-z]|$)|reasoner|deepseek-r1|qwen-max|gpt-4o(?!-mini)|claude-(?:3-)?opus|claude-opus|glm-4-plus|o3(?:[^a-z]|$)/.test(
      m,
    )
  ) {
    return "advisor";
  }
  if (/turbo|flash|mini|nano|haiku|qwen-turbo|glm-4-flash|gpt-4o-mini/.test(m)) {
    return "worker";
  }
  return "general";
}

export function modelWorkTierLabel(tier: ModelWorkTier): string {
  switch (tier) {
    case "advisor":
      return "Advisor（重推理）";
    case "worker":
      return "Worker（快执行）";
    default:
      return "通用";
  }
}
