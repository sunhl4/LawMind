/**
 * User- and model-facing messages for Word/docx render failures.
 * Word 渲染走本地 docx 引擎，不调用大模型 API。
 */

export type RenderFailureCategory =
  | "approval_required"
  | "acceptance_gate"
  | "missing_draft"
  | "render_engine"
  | "unsupported_format"
  | "unknown";

export function classifyRenderFailure(error: string | undefined): RenderFailureCategory {
  const e = (error ?? "").toLowerCase();
  if (!e) {
    return "unknown";
  }
  if (e.includes("尚未通过审核") || e.includes("未通过审核") || e.includes("pending")) {
    return "approval_required";
  }
  if (e.includes("验收门禁") || e.includes("acceptance") || e.includes("blockers=")) {
    return "acceptance_gate";
  }
  if (e.includes("找不到") || e.includes("没有可渲染")) {
    return "missing_draft";
  }
  if (e.includes("不支持渲染格式")) {
    return "unsupported_format";
  }
  if (e.includes("模板") || e.includes("docx") || e.includes("渲染失败")) {
    return "render_engine";
  }
  return "unknown";
}

const CATEGORY_HINT: Record<RenderFailureCategory, string> = {
  approval_required:
    "草稿尚未在审核台通过。请在对话中请律师明确同意导出后，用 render_document 并传 approve=true；或先在桌面「审核」页签批准该草稿。",
  acceptance_gate:
    "草稿未通过交付验收门禁（缺章节或占位符等）。请补齐后重试 render_document；若律师已确认可带占位符交付，可传 bypass_acceptance_gate=true（与 approve=true 联用）。",
  missing_draft:
    "尚无可用草稿。请先 execute_workflow 或 draft_document 生成草稿，再调用 render_document。",
  render_engine:
    "本地 Word 渲染引擎失败（与模型 API 无关）。请检查工作区 artifacts 目录可写、模板文件是否存在，或查看错误详情。",
  unsupported_format: "当前草稿输出格式不是 docx/pptx，无法生成 Word。请确认任务类型或模板。",
  unknown: "本地渲染未完成。请根据下方详情处理；勿向用户谎称「模型 API 异常」导致无法导出 Word。",
};

/** Agent tool `error` string — explicitly separates model API from local Word render. */
export function formatRenderToolError(
  rawError: string | undefined,
  opts?: { toolName?: string },
): string {
  const category = classifyRenderFailure(rawError);
  const tool = opts?.toolName ?? "render_document";
  const detail = rawError?.trim() || "未知原因";
  return [
    `无法生成 Word 文件（${tool}）：${detail}`,
    `说明：导出 .docx 由本机 LawMind 渲染引擎完成，不消耗、也不依赖当前对话的模型 API。`,
    CATEGORY_HINT[category],
  ].join("\n");
}

/** Short line for execute_workflow steps / status when render fails. */
export function formatWorkflowRenderFailure(rawError: string | undefined): string {
  return formatRenderToolError(rawError, { toolName: "execute_workflow 渲染步骤" });
}
