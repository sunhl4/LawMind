/**
 * After context compact, remind the model that RULES / deliverable / Craft still bind.
 */

import { mergeLegacyUpdateDraftWarningIntoCraft } from "../drafts/legacy-update-draft-warning.js";
import {
  insertBeforeLastUserMessage,
  isCompactSyntheticUserMessage,
  COMPACT_REINJECTION_MARKER,
} from "./compact-insert.js";
import { formatTurnPlanWorldState } from "./turn-plan.js";
import type { AgentSession } from "./types.js";
import { collectWorldStateHashes, upsertWorldStateSection } from "./world-state.js";

export { COMPACT_REINJECTION_MARKER } from "./compact-insert.js";

/** 任务锚点（钉子）的长度上限：够写清「要做什么」，又不至于把系统段撑胖。 */
export const TASK_PIN_CHAR_CAP = 600;

/** 从历史里取最早一条**真实**律师发言作为任务锚点（跳过合成消息）。 */
export function extractTaskPin(session: AgentSession): string | undefined {
  for (const msg of session.conversationHistory) {
    if (msg.role !== "user") {
      continue;
    }
    const text = (msg.content ?? "").trim().replace(/\s+/g, " ");
    if (!text) {
      continue;
    }
    if (isCompactSyntheticUserMessage(text)) {
      continue;
    }
    return text.slice(0, TASK_PIN_CHAR_CAP);
  }
  return undefined;
}

/**
 * 压缩后重注块。
 *
 * 除红线外，这里还钉住两样**不能靠摘要传承**的东西（本仓实测：摘要只取「末 N 条
 * 律师要点」，律师发言一多，原始任务陈述第 1 轮就会掉；Codex 靠保 20k token 原始
 * 用户消息解决，但它不保证跨多次压缩稳定）。
 *
 * 钉子的强度来自它被写进**系统段的 world-state 段**：压缩只保留 `system[0]`，
 * 所以任务锚点与待澄清键在这里是**跨任意次压缩原样存活**的，不参与摘要、不被截断，
 * 也不增长（有帽）。这是我们对 Codex（保原始消息）与 Cursor（`TASK.md` 文件）
 * 两条路的合流：既自动、又有界、又确定。
 */
export function formatCompactReinjectionBlock(opts?: {
  mandatoryRulesActive?: boolean;
  /** 任务锚点（原文，非摘要）。 */
  taskStatement?: string;
  /** 仍生效的待澄清键：写清「未答齐前不得起草/渲染」，别写成裸键名。 */
  pendingClarificationKeys?: readonly string[];
}): string {
  const rulesHint = opts?.mandatoryRulesActive
    ? "工作区 RULES / 强制规则仍有效。"
    : "交付与安全红线仍有效。";
  const lines = [
    `## ${COMPACT_REINJECTION_MARKER}`,
    "",
    "刚完成上下文压缩，下列约束**不得**因摘要而丢弃：",
    `- ${rulesHint}`,
    "- 正式交付物须走工具链与审核台；待审核稿不得写成可对外签发。",
    "- 合同改稿遵循 Craft（必要性/形式克制/覆盖完整）；空修订不得导出。",
    "- 未批准不得 send_email / 危险工具；密钥与假完成硬禁。",
  ];
  const task = opts?.taskStatement?.trim();
  if (task) {
    lines.push(
      "",
      `- **任务锚点（原文钉住，不因摘要改写）**：${task}`,
      "- 若本回合的指令与任务锚点不同，以**律师最新的那条指令**为准；锚点用于防止长会话里丢掉「本来要做什么」。",
    );
  }
  const keys = (opts?.pendingClarificationKeys ?? []).map((k) => k.trim()).filter(Boolean);
  if (keys.length > 0) {
    lines.push(`- 待澄清键（仍生效，未答齐前不得起草/渲染）：${keys.join("、")}`);
  }
  return lines.join("\n");
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
  // 钉子优先取**持久化**的那一句（`session.taskPin`，由 runTurn 首次确定）；
  // 老会话（该字段出现之前建的）才回落到「从历史里找最早一条真实律师发言」。
  const pinned = session.taskPin?.text?.trim() || extractTaskPin(session);
  let block = formatCompactReinjectionBlock({
    ...opts,
    ...(pinned ? { taskStatement: pinned } : {}),
    pendingClarificationKeys: session.pendingClarificationKeys,
  });
  if (session.legacyUpdateDraftBodyWarning) {
    block = mergeLegacyUpdateDraftWarningIntoCraft(block);
  }
  const sys = session.conversationHistory.find((m) => m.role === "system");
  if (sys) {
    sys.content = upsertWorldStateSection(sys.content, "craft", block);
    if (session.turnPlan) {
      sys.content = upsertWorldStateSection(
        sys.content,
        "plan",
        formatTurnPlanWorldState(session.turnPlan),
      );
    }
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
