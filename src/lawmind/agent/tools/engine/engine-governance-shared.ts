import { resolveMatterId } from "./engine-tool-shared.js";

export const QUEUE_KIND_VALUES = [
  "need_client_input",
  "need_evidence",
  "need_conflict_check",
  "need_lawyer_review",
  "need_partner_approval",
  "ready_to_draft",
  "ready_to_render",
  "blocked_by_deadline",
  "blocked_by_missing_strategy",
] as const;

export const QUEUE_PRIORITY_VALUES = ["low", "normal", "high", "critical"] as const;
export const RISK_LEVEL_VALUES = ["low", "medium", "high"] as const;
export const DEADLINE_SEVERITY_VALUES = ["soft", "hard", "critical"] as const;

export function ensureMatterId(value: unknown, fallback: string | undefined): string {
  const matterId = resolveMatterId(value, fallback);
  if (!matterId) {
    throw new Error("matter_id 缺失：请显式传入或在会话中设置 matterId。");
  }
  return matterId;
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string") {
    throw new Error(`${field} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!allowed.includes(trimmed as T)) {
    throw new Error(`${field} 必须是 ${allowed.join(" / ")}`);
  }
  return trimmed as T;
}
