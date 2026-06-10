import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";

export function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  // Prefer RFC 5987 filename* if present.
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  }
}

export function reviewStatusFilterLabel(status: ArtifactDraft["reviewStatus"] | "all"): string {
  switch (status) {
    case "pending":
      return "待审核";
    case "modified":
      return "需修改";
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "all":
      return "全部状态";
  }
}

export function executionStateLabel(state: TaskExecutionState | null): string {
  if (!state) {
    return "未知";
  }
  const statusLabel: Record<TaskExecutionState["status"], string> = {
    running: "进行中",
    awaiting_approval: "待审批",
    awaiting_clarification: "待澄清",
    completed: "已完成",
    failed: "失败",
  };
  const phaseLabel: Record<TaskExecutionState["phase"], string> = {
    clarify: "澄清",
    plan: "计划",
    research: "研判",
    draft: "起草",
    approval: "审批",
    render: "渲染",
    complete: "完成",
    error: "异常",
  };
  return `${phaseLabel[state.phase]} · ${statusLabel[state.status]}`;
}

type OfficecliResponseBody = {
  code?: string;
  error?: string;
  message?: string;
  mode?: string;
};

export function isOfficecliMissingResponse(body: OfficecliResponseBody): boolean {
  return (
    body.code === "officecli_missing" || /officecli/i.test(body.error ?? body.message ?? "")
  );
}

export function officecliMissingBannerMessage(): string {
  return "未检测到 officecli，已尝试回退为普通 docx；请安装 officecli 以获得完整修订痕迹。";
}

export function officecliPlainFallbackNote(mode?: string): string {
  return mode === "plain_fallback" ? "（无 officecli，已回退普通 docx）" : "";
}

export function officecliMissingErrorMessage(
  body: OfficecliResponseBody,
  fallback: string,
): string {
  if (isOfficecliMissingResponse(body)) {
    return officecliMissingBannerMessage();
  }
  return fallback;
}
