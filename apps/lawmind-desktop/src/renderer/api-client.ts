/**
 * Parse LawMind local API error responses for display hints (chat retry guidance).
 */

export type ApiErrorJson = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  reason?: string;
  description?: string;
  /** FastAPI / Nest 等可能返回字符串、对象或校验项数组 */
  detail?: string | unknown[] | Record<string, unknown>;
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

function normalizeDetail(detail: unknown): string {
  if (detail == null) {
    return "";
  }
  if (typeof detail === "string") {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const msg =
          typeof o.msg === "string"
            ? o.msg
            : typeof o.message === "string"
              ? o.message
              : "";
        const loc = o.loc;
        const locStr = Array.isArray(loc)
          ? loc
              .filter((x) => typeof x === "string" || typeof x === "number")
              .map(String)
              .join(".")
          : "";
        if (msg && locStr) {
          return `${locStr}: ${msg}`;
        }
        if (msg) {
          return msg;
        }
      }
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    });
    return parts.filter(Boolean).join("；");
  }
  if (typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return "[unserializable detail]";
    }
  }
  if (typeof detail === "number" || typeof detail === "bigint" || typeof detail === "boolean") {
    return String(detail);
  }
  if (typeof detail === "symbol") {
    return detail.toString();
  }
  return "";
}

/** HTTP 200 且 JSON 里 `ok: false` 时，从常见字段拼可读说明（去重）。 */
export function messageFromOkFalseBody(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const b = body as ApiErrorJson & Record<string, unknown>;
  const chunks: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !chunks.includes(t)) {
      chunks.push(t);
    }
  };
  if (typeof b.message === "string") {
    push(b.message);
  }
  if (typeof b.error === "string") {
    push(b.error);
  }
  if (typeof b.reason === "string") {
    push(b.reason);
  }
  if (typeof b.description === "string") {
    push(b.description);
  }
  const d = normalizeDetail(b.detail);
  if (d) {
    push(d);
  }
  if (chunks.length > 0) {
    return chunks.join(" — ");
  }
  return fallback;
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
  const chunks: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !chunks.includes(t)) {
      chunks.push(t);
    }
  };
  if (typeof body.message === "string") {
    push(body.message);
  }
  if (typeof body.error === "string") {
    push(body.error);
  }
  if (typeof body.reason === "string") {
    push(body.reason);
  }
  if (typeof body.description === "string") {
    push(body.description);
  }
  const detailStr = normalizeDetail(body.detail);
  if (detailStr) {
    push(detailStr);
  }
  const base = chunks.length > 0 ? chunks.join(" — ") : `请求失败（HTTP ${status}）`;
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

/** 读取响应正文并解析 JSON；失败时抛出 ApiRequestError（含片段原文，便于排查网关/HTML 报错页）。 */
export async function readJsonFromResponse<T>(response: Response): Promise<T & ApiErrorJson> {
  const text = await response.text();
  if (!text.trim()) {
    return {} as T & ApiErrorJson;
  }
  try {
    return JSON.parse(text) as T & ApiErrorJson;
  } catch {
    const snippet = text.slice(0, 240).replace(/\s+/g, " ").trim();
    const tail = text.length > 240 ? "…" : "";
    throw new ApiRequestError(
      response.status,
      snippet
        ? `无法解析 JSON 响应（HTTP ${response.status}）：${snippet}${tail}`
        : `无法解析 JSON 响应（HTTP ${response.status}）`,
      null,
    );
  }
}

export async function apiGetJson<T>(apiBase: string, path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  const body = await readJsonFromResponse<T>(response);
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
  const responseBody = await readJsonFromResponse<TResponse>(response);
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
    const msg = error.message.trim();
    if (!msg) {
      return fallback;
    }
    if (error.status >= 400 && !msg.includes(`HTTP ${error.status}`) && !msg.includes(`无法解析 JSON`)) {
      return `[HTTP ${error.status}] ${msg}`;
    }
    return msg;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
