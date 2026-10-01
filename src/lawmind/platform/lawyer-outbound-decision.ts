/**
 * 待拍板口径：外发不再打断回合。
 * 内部起草 / 审查 / 改稿 / 外发拟稿都直接出结果——外发写入本案「待发信」，
 * 律师在待发列表核对后点「批准发送」才真正发出；回合一律照常完成。
 */

import { irreversibleDisposition, irreversibleImpactLabelZh } from "../agent/tool-name-sets.js";

export const OUTBOUND_TOOL_NAMES = new Set(["send_email", "prepare_outbound_mail"]);

export { irreversibleDisposition, irreversibleImpactLabelZh };

/** 会把材料发给别人的交办模板。 */
export const OUTBOUND_AUTOMATION_PRESET_IDS = new Set([
  "client-weekly-update",
  "mail-contract-review",
]);

/** 会把材料发给别人的办案流程。 */
export const OUTBOUND_WORKFLOW_TEMPLATE_IDS = new Set([
  "mail-contract-redline",
  "client-update-memo",
]);

export function isOutboundToolName(name?: string | null): boolean {
  const n = name?.trim();
  return Boolean(n && OUTBOUND_TOOL_NAMES.has(n));
}

/** `Name <a@b.com>` or bare address → lowercase mailbox. Empty if no `@`. */
export function normalizeOutboundRecipient(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const angle = trimmed.match(/<([^>]+@[^>]+)>/);
  const candidate = (angle?.[1] ?? trimmed).trim().replace(/[>)\],;]+$/g, "");
  return candidate.includes("@") ? candidate.toLowerCase() : "";
}

/** 创建交办时：周报 / 邮件合同 / 填了外发邮箱 / 话里要外发。 */
export function isOutboundAutomationContext(input: {
  presetId?: string | null;
  defaultAllowSend?: boolean;
  notifyEmail?: string | null;
  instruction?: string | null;
}): boolean {
  const preset = input.presetId?.trim() ?? "";
  if (OUTBOUND_AUTOMATION_PRESET_IDS.has(preset) || input.defaultAllowSend === true) {
    return true;
  }
  if (input.notifyEmail?.trim()) {
    return true;
  }
  const blob = input.instruction?.trim() ?? "";
  return /发[给送信]|外发|批准后发|send_email|prepare_outbound_mail/.test(blob);
}

/** 办案流程是否会离开律师这边（外发邮件 / 客户备忘）。 */
export function workflowTemplateIsOutbound(input: {
  id?: string | null;
  description?: string | null;
  preApproveToolNames?: string[] | null;
  steps?: Array<{ task?: string | null }> | null;
}): boolean {
  const id = input.id?.trim() ?? "";
  if (OUTBOUND_WORKFLOW_TEMPLATE_IDS.has(id)) {
    return true;
  }
  if (input.preApproveToolNames?.some((name) => isOutboundToolName(name))) {
    return true;
  }
  const blob = [id, input.description ?? "", ...(input.steps ?? []).map((s) => s.task ?? "")].join(
    "\n",
  );
  return /prepare_outbound_mail|send_email/.test(blob);
}

/** 工具门禁：自 2026-10-01 起没有 disposition=`pause` 的工具，本函数恒为 false。 */
export function toolRequiresLawyerPause(name?: string | null): boolean {
  return irreversibleDisposition(name) === "pause";
}

export type LawyerDecisionTicketInput = {
  kind?: string | null;
  status?: string | null;
  toolName?: string | null;
  actionKind?: string | null;
};

/** 侧栏「待我拍板」与在办队列共用。澄清仍算：不问完办不下去。 */
export function isLawyerOutboundDecision(input: LawyerDecisionTicketInput): boolean {
  const kind = input.kind?.trim() || "";
  const actionKind = input.actionKind?.trim() || "";
  const status = input.status?.trim() || "";

  if (kind === "automation_send") {
    return true;
  }
  if (actionKind === "continue_tools") {
    return false;
  }
  // 门禁把本件停下（缺口待处置）：不是外发，但确实卡在律师这边，必须进待我拍板。
  if (actionKind === "workflow_blocked") {
    return true;
  }
  if (kind === "pending_review" || kind === "matter_approval" || kind === "word_check") {
    return false;
  }
  if (actionKind === "clarification" || status === "awaiting_clarification") {
    return true;
  }
  if (kind === "tool_approval" || actionKind === "tool_approval") {
    return isOutboundToolName(input.toolName);
  }
  if (kind === "chat") {
    return status === "awaiting_clarification" || isOutboundToolName(input.toolName);
  }
  // 队列项：仅「问客户」会标 awaiting_approval（见 build-agent-fleet）。
  if (kind === "queue_item") {
    return status === "awaiting_approval";
  }
  return false;
}
