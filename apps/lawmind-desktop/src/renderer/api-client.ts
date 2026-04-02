/**
 * Parse LawMind local API error responses for display hints (chat retry guidance).
 */

export type ApiErrorJson = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  detail?: string;
};

export class ApiRequestError extends Error {
  status: number;
  body: ApiErrorJson | null;

  constructor(status: number, message: string, body: ApiErrorJson | null = null) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.body = body;
  }
}

const CODE_HINTS: Record<string, string> = {
  missing_api_key: "请在设置中打开「API 配置向导」，或编辑用户目录下的 .env.lawmind 填写模型 API Key。",
  invalid_matter_id: "案件 ID 格式不正确。请使用字母或数字开头，2–128 字符，仅含字母、数字、点、下划线、连字符。",
  message_required: "请输入有效内容后再发送。",
  invalid_matter_id_chat: "当前关联的案件 ID 无效，请清空或更正后再试。",
  session_assistant_mismatch: "该会话属于其他助手，请新开对话或清空会话后重试。",
  model_unavailable: "模型服务暂时不可用。请检查网络、API Key 与模型服务商状态。",
};

export function userMessageFromApiError(status: number, body: ApiErrorJson): string {
  const code = typeof body.code === "string" ? body.code : "";
  const base =
    (typeof body.message === "string" && body.message.trim()
      ? body.message
      : typeof body.detail === "string" && body.detail.trim()
        ? body.detail
        : typeof body.error === "string" && body.error.trim()
          ? body.error
          : "") || `请求失败（HTTP ${status}）`;
  const hint = code && CODE_HINTS[code] ? ` ${CODE_HINTS[code]}` : "";
  if (status === 503 || status === 502) {
    return `${base}${hint || " 请检查 API Key、网络与本地服务是否正常。"}`;
  }
  if (status === 401 || status === 403) {
    return `${base} 请检查 API Key 是否有效、是否过期。`;
  }
  if (status === 409 && code === "session_assistant_mismatch") {
    return `${base}${hint}`;
  }
  return `${base}${hint}`;
}

export function chatErrorUserText(status: number, body: ApiErrorJson): string {
  return userMessageFromApiError(status, body);
}

async function readJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export async function apiGetJson<T>(apiBase: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  const body = await readJsonBody<T & ApiErrorJson>(response);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      userMessageFromApiError(response.status, body),
      body,
    );
  }
  return body;
}

export async function apiSendJson<TResponse, TBody>(
  apiBase: string,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: TBody,
): Promise<TResponse> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await readJsonBody<TResponse & ApiErrorJson>(response);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      userMessageFromApiError(response.status, responseBody),
      responseBody,
    );
  }
  return responseBody;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
