/** Pure helpers shared by App shell and workbenches. */

export function resolveWorkspacePath(workspaceDir: string, rel: string): string {
  const r = rel.replace(/\\/g, "/").replace(/^\//, "");
  const w = workspaceDir.replace(/\\/g, "/").replace(/\/$/, "");
  return `${w}/${r}`;
}

/** Relative path for GET /api/artifact?path= (must stay under workspace `artifacts/`) */
export function artifactApiRelFromOutput(outputPath?: string): string | null {
  if (!outputPath) {
    return null;
  }
  const norm = outputPath.replace(/\\/g, "/").replace(/^\//, "");
  if (norm.startsWith("artifacts/")) {
    return norm;
  }
  if (!norm.includes("/")) {
    return `artifacts/${norm}`;
  }
  return null;
}

export function formatLocaleDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
  } catch {
    return iso;
  }
}

export function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) {
      return iso;
    }
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) {
      return "刚刚";
    }
    if (diff < 3_600_000) {
      return `${Math.floor(diff / 60_000)} 分钟前`;
    }
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const hhmm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d >= today) {
      return `今天 ${hhmm}`;
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d >= yesterday) {
      return `昨天 ${hhmm}`;
    }
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  } catch {
    return iso;
  }
}

export function legalStatusLabel(status: string | undefined, kind?: string): string {
  if (kind === "agent.instruction") {
    return "对话";
  }
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "已完成";
  }
  if (normalized === "running" || normalized === "processing") {
    return "处理中";
  }
  if (normalized === "error" || normalized === "failed") {
    return "处理失败";
  }
  if (normalized === "pending") {
    return "待处理";
  }
  if (normalized === "draft") {
    return "草稿";
  }
  if (normalized === "task") {
    return "任务";
  }
  return status ?? "任务";
}

export function taskBadgeClass(status: string, kind?: string): string {
  if (kind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  const normalized = status.toLowerCase();
  if (normalized === "done" || normalized === "completed") {
    return "lm-badge lm-badge-done";
  }
  if (normalized === "running" || normalized === "processing") {
    return "lm-badge lm-badge-running";
  }
  if (normalized === "error" || normalized === "failed") {
    return "lm-badge lm-badge-error";
  }
  return "lm-badge";
}

export function historyBadgeClass(kind: string, taskRecordKind?: string, status?: string): string {
  if (kind === "draft") {
    return "lm-badge lm-badge-draft";
  }
  if (taskRecordKind === "agent.instruction") {
    return "lm-badge lm-badge-chat";
  }
  if (status) {
    return taskBadgeClass(status);
  }
  return "lm-badge";
}
