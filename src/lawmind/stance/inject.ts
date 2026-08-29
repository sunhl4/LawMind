/**
 * Ranked Chinese stance lines for the agent system prompt.
 */

import { readStanceItems } from "./store.js";

const MIN_HINT_CONFIDENCE = 0.4;

export function formatStanceHint(workspaceDir: string, max = 8): string {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 8;
  const ranked = readStanceItems(workspaceDir)
    .filter((it) => !it.supersededBy && it.confidence >= MIN_HINT_CONFIDENCE)
    .toSorted((a, b) => b.confidence * b.occurrences - a.confidence * a.occurrences)
    .slice(0, limit);
  if (ranked.length === 0) {
    return "";
  }
  const lines = ranked.map((it, i) => `${i + 1}. 【${it.clauseType}】${it.preferredLanguage}`);
  return ["已按你确认的条款立场：", ...lines].join("\n");
}
