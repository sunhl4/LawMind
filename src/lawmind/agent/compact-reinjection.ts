/**
 * After context compact, remind the model that RULES / deliverable / Craft still bind.
 */

import { insertBeforeLastUserMessage, COMPACT_REINJECTION_MARKER } from "./compact-insert.js";
import type { AgentSession } from "./types.js";
import { collectWorldStateHashes, upsertWorldStateSection } from "./world-state.js";

export { COMPACT_REINJECTION_MARKER } from "./compact-insert.js";

export function formatCompactReinjectionBlock(opts?: { mandatoryRulesActive?: boolean }): string {
  const rulesHint = opts?.mandatoryRulesActive
    ? "工作区 RULES / 强制规则仍有效。"
    : "交付与安全红线仍有效。";
  return [
    `## ${COMPACT_REINJECTION_MARKER}`,
    "",
    "刚完成上下文压缩，下列约束**不得**因摘要而丢弃：",
    `- ${rulesHint}`,
    "- 正式交付物须走工具链与审核台；待审核稿不得写成可对外签发。",
    "- 合同改稿遵循 Craft（必要性/形式克制/覆盖完整）；空修订不得导出。",
    "- 未批准不得 send_email / 危险工具；密钥与假完成硬禁。",
  ].join("\n");
}

/**
 * Keep the static system prefix; patch `craft` in-place and insert the 红线
 * immediately before the last real user message so it stays in-window.
 */
export function applyCompactReinjectionToSession(
  session: AgentSession,
  opts?: { mandatoryRulesActive?: boolean },
): boolean {
  if (!session.needsCompactReinjection) {
    return false;
  }
  const block = formatCompactReinjectionBlock(opts);
  const sys = session.conversationHistory.find((m) => m.role === "system");
  if (sys) {
    sys.content = upsertWorldStateSection(sys.content, "craft", block);
    sys.timestamp = new Date().toISOString();
    session.worldStateBaseline = collectWorldStateHashes(sys.content);
    session.worldStateEpoch = (session.worldStateEpoch ?? 0) + 1;
  }
  const alreadyBeforeUser = session.conversationHistory.some(
    (m) => m.role === "user" && (m.content ?? "").includes(COMPACT_REINJECTION_MARKER),
  );
  if (!alreadyBeforeUser) {
    session.conversationHistory = insertBeforeLastUserMessage(session.conversationHistory, [
      {
        role: "user",
        content: block,
        timestamp: new Date().toISOString(),
      },
    ]);
  }
  const applied =
    Boolean(sys) ||
    session.conversationHistory.some((m) => (m.content ?? "").includes(COMPACT_REINJECTION_MARKER));
  if (!applied) {
    return false;
  }
  session.needsCompactReinjection = false;
  return true;
}
