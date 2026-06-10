import type { ArtifactDraft, MatterIndex, TaskRecord } from "../types.js";
import type { DeliverableLifecycleStatus } from "./deliverable-lifecycle.js";

export type DeliverableKind =
  | "legal-memo"
  | "contract-review"
  | "demand-letter"
  | "litigation-outline"
  | "client-brief"
  | "evidence-timeline"
  | "general-document";

export type MatterStatus =
  | "intake"
  | "active"
  | "waiting_on_client"
  | "waiting_on_firm"
  | "under_review"
  | "delivered"
  | "closed";

type DeliverableAudience = "internal" | "client" | "counterparty" | "court" | "unknown";
type WorkQueuePriority = "low" | "normal" | "high" | "critical";
type StrategyStatus = "missing" | "draft" | "approved" | "stale";
type MatterSensitivity = "normal" | "high" | "restricted";

export function classifyDeliverableKind(draft: ArtifactDraft): DeliverableKind {
  const templateId = draft.templateId.toLowerCase();
  const text = `${draft.title}\n${draft.summary}\n${templateId}`.toLowerCase();
  if (text.includes("contract")) {
    return "contract-review";
  }
  if (text.includes("demand") || text.includes("律师函")) {
    return "demand-letter";
  }
  if (text.includes("litigation") || text.includes("诉讼")) {
    return "litigation-outline";
  }
  if (text.includes("brief") || draft.output === "pptx") {
    return "client-brief";
  }
  if (text.includes("timeline") || text.includes("时间线")) {
    return "evidence-timeline";
  }
  if (text.includes("memo") || text.includes("意见")) {
    return "legal-memo";
  }
  return "general-document";
}

export function classifyAudience(audience?: string): DeliverableAudience {
  const value = audience?.trim().toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (value.includes("client") || value.includes("客户")) {
    return "client";
  }
  if (value.includes("court") || value.includes("法院")) {
    return "court";
  }
  if (value.includes("counterparty") || value.includes("对方")) {
    return "counterparty";
  }
  if (value.includes("internal") || value.includes("内部") || value.includes("lawyer")) {
    return "internal";
  }
  return "unknown";
}

export function deriveDeliverableStatus(draft: ArtifactDraft): DeliverableLifecycleStatus {
  if (draft.outputPath) {
    return "rendered";
  }
  if (draft.reviewStatus === "approved") {
    return "approved";
  }
  if (draft.reviewStatus === "pending") {
    return "pending_review";
  }
  if (draft.reviewStatus === "rejected" || draft.reviewStatus === "modified") {
    return "blocked";
  }
  return "drafting";
}

export function deriveMatterStatus(index: MatterIndex): MatterStatus {
  if (index.tasks.length === 0 && index.drafts.length === 0) {
    return "intake";
  }
  if (index.drafts.some((draft) => draft.reviewStatus === "pending")) {
    return "under_review";
  }
  if (index.openTasks.length > 0) {
    return "active";
  }
  if (index.renderedTasks.length > 0) {
    return "delivered";
  }
  return "active";
}

export function deriveStrategyStatus(index: MatterIndex): StrategyStatus {
  if (!index.caseMemory.trim()) {
    return "missing";
  }
  if (index.coreIssues.length === 0 && index.taskGoals.length === 0) {
    return "draft";
  }
  return "approved";
}

export function deriveMatterTitle(index: MatterIndex): string {
  return index.coreIssues[0] ?? index.taskGoals[0] ?? index.matterId;
}

export function deriveMatterSensitivity(index: MatterIndex): MatterSensitivity {
  if (index.riskNotes.length >= 3) {
    return "high";
  }
  return "normal";
}

export function deriveNextActions(index: MatterIndex): string[] {
  const fromTasks = index.openTasks.slice(0, 5).map((task) => `${task.status}: ${task.summary}`);
  if (fromTasks.length > 0) {
    return fromTasks;
  }
  return index.taskGoals.slice(0, 5);
}

export function queuePriorityFromRisk(riskLevel?: TaskRecord["riskLevel"]): WorkQueuePriority {
  if (riskLevel === "high") {
    return "critical";
  }
  if (riskLevel === "medium") {
    return "high";
  }
  return "normal";
}

export function needsEvidenceFollowup(text: string): boolean {
  return /(待补充|待确认|缺失|补充|核对|证据)/.test(text);
}
