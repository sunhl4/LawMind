/**
 * 收案卡的错误文案：HTTP 稳定 code → 律师能读懂的一句话。
 *
 * 收案卡和委托包区块共用；`body.error` 是 API 的稳定 code（`sendJson` 路径），
 * 人话解释只在这里维护一份。
 */

import { errorMessage } from "../api-client";

export function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === "object" && body !== null) {
      // sendJsonError 带稳定 `code`；普通结果只有 `error`（同值为 code）。
      if ("code" in body && typeof body.code === "string") {
        return body.code;
      }
      if ("error" in body && typeof body.error === "string") {
        return body.error;
      }
    }
  }
  return undefined;
}

export function admissionErrorMessage(error: unknown): string {
  switch (errorCode(error)) {
    case "conflict_pending":
      return "冲突扫描还没完成，先运行扫描。";
    case "conflict_override_required":
      return "扫描有命中，接受委托前必须填写书面理由。";
    case "disclosures_missing":
      return "先确认风险告知与 AI 使用告知。";
    case "owner_missing":
      return "先指定本案负责人。";
    case "no_candidates":
      return "先添加候选当事人；空扫描不能当作无冲突。";
    case "already_decided":
      return "这条收案记录已经有决定，不能重复操作。";
    case "not_found":
      return "收案记录不存在，请先开始收案。";
    case "exists":
      return "委托包或 DOCX 已存在（可能被律师改过）。确认覆盖后再继续。";
    case "missing_fields":
      return "先填委托人和律师费。";
    case "package_not_found":
      return "先生成委托包草案，再导出 DOCX。";
    case "render_failed":
      return "DOCX 渲染失败，请检查委托包正文是否完整。";
    case "write_failed":
      return "DOCX 写入失败，请检查工作区是否可写。";
    default:
      return errorMessage(error, "收案操作失败");
  }
}
