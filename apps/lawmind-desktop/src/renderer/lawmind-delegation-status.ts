import type { DelegationRow } from "./lawmind-app-data";

export function delegationStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "等待接单";
    case "running":
      return "处理中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "timeout":
      return "超时";
    case "completed_after_timeout":
      return "超时后交回";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function delegationStatusBadgeClass(status: string): string {
  if (status === "completed" || status === "completed_after_timeout") {
    return "lm-badge lm-badge-done";
  }
  if (status === "running") {
    return "lm-badge lm-badge-running";
  }
  if (status === "failed" || status === "timeout") {
    return "lm-badge lm-badge-error";
  }
  if (status === "pending") {
    return "lm-badge lm-badge-running";
  }
  return "lm-badge";
}

export function delegationSummaryLine(
  row: DelegationRow,
  assistantDisplayById?: Record<string, string>,
): string {
  const toName = assistantDisplayById?.[row.toAssistant] ?? row.toAssistant;
  const task = row.task.trim().slice(0, 60);
  switch (row.status) {
    case "pending":
      return `等待「${toName}」接单 · ${task}`;
    case "running":
      return `「${toName}」处理中 · ${task}`;
    case "completed":
      return `「${toName}」已完成 · ${task}`;
    case "completed_after_timeout":
      return `「${toName}」超时后交回结果 · ${task}`;
    case "failed":
    case "timeout":
      return `「${toName}」未成功 · ${task}`;
    default:
      return `${toName} · ${task}`;
  }
}

export function isActiveDelegation(row: DelegationRow): boolean {
  return row.status === "pending" || row.status === "running";
}

export function assistantIdsBusyFromDelegations(delegations: DelegationRow[]): Set<string> {
  const busy = new Set<string>();
  for (const d of delegations) {
    if (isActiveDelegation(d) && d.toAssistant?.trim()) {
      busy.add(d.toAssistant.trim());
    }
  }
  return busy;
}
