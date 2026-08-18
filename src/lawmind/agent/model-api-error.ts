/**
 * Map provider model-HTTP failures to lawyer-facing copy.
 * Never surface raw JSON, payment URLs, or key fragments in the chat pane.
 */

export type ModelApiFailureCode = "model_account_blocked" | "invalid_api_key" | "model_unavailable";

export type ModelApiFailure = {
  code: ModelApiFailureCode;
  message: string;
  httpStatus: number;
};

export class ModelApiError extends Error {
  readonly code: ModelApiFailureCode;
  readonly httpStatus: number;

  constructor(failure: ModelApiFailure) {
    super(failure.message);
    this.name = "ModelApiError";
    this.code = failure.code;
    this.httpStatus = failure.httpStatus;
  }
}

const ACCOUNT_RE =
  /arrearage|overdue-payment|overdue|insufficient.?quota|billing|balance|欠费|欠款|余额不足/i;
const KEY_RE =
  /invalid.?api.?key|incorrect.?api.?key|unauthorized|authentication|api.?key.*invalid|密钥无效/i;

export function describeModelApiFailure(status: number, bodyText: string): ModelApiFailure {
  const haystack = `${status} ${bodyText}`;
  if (ACCOUNT_RE.test(haystack)) {
    return {
      code: "model_account_blocked",
      httpStatus: 503,
      message: "模型账户不可用（欠费或无权调用）。请到设置检查 API Key 与服务商账户。",
    };
  }
  if (status === 401 || status === 403 || KEY_RE.test(haystack)) {
    return {
      code: "invalid_api_key",
      httpStatus: status === 403 ? 403 : 401,
      message: "模型 API Key 无效或已过期。请到设置重新填写。",
    };
  }
  if (status === 404) {
    return {
      code: "model_unavailable",
      httpStatus: 503,
      message: "模型服务未找到。请检查设置里的模型名与接口地址是否与服务商一致。",
    };
  }
  return {
    code: "model_unavailable",
    httpStatus: status >= 500 ? 502 : 503,
    message: "模型服务暂时不可用。请检查网络、API Key 与模型服务商状态。",
  };
}

export function isModelApiError(error: unknown): error is ModelApiError {
  return error instanceof ModelApiError;
}

/** Defense in depth: strip leftover provider JSON if it still reaches the UI. */
export function sanitizeModelApiErrorText(text: string): string {
  const raw = text.trim();
  if (!raw) {
    return raw;
  }
  if (!/Model API error|Arrearage|overdue-payment|insufficient_quota|"error"\s*:\s*\{/i.test(raw)) {
    return raw;
  }
  const statusMatch = /Model API error (\d{3})/i.exec(raw);
  const status = statusMatch ? Number(statusMatch[1]) : 400;
  return describeModelApiFailure(status, raw).message;
}
