/**
 * Renderer 侧统一 API 客户端代理层
 *
 * 所有 renderer 向外/向本地 API 的 HTTP 请求经此收口：
 *   - 自动注入本地 API Bearer token
 *   - 统一 base URL 解析（生产/开发/测试）
 *   - 统一错误转换（403/500/网络错误 → 律师友好文案）
 *   - 统一请求/响应日志（只记录 method、path、status，不记录 body）
 *   - 超时、重试策略
 *   - 默认拒绝非本地 http（与引擎侧统一出口代理对齐）
 *   - 审计事件：outbound_http 通过本地 API 写入引擎侧审计
 */

import { apiAuthHeaders, getLoopbackApiAuthToken, setLoopbackApiAuthToken } from "./lawmind-api-auth.ts";
import { refreshLoopbackAuthFromDesktop } from "./lawmind-dev-config-cache.ts";
import {
  friendlyModelErrorMessage,
  isModelProviderErrorMessage,
} from "../../../../src/lawmind/agent/model-error-message.ts";

export type ApiErrorJson = {
  ok?: boolean;
  code?: string;
  message?: string;
  error?: string;
  /** 服务端给出的可操作提示（如路由未匹配时的升级说明） */
  hint?: string;
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

/** Shared copy for compose banner, readiness strip, and send-time errors. */
export const MODEL_NOT_CONFIGURED_USER_HINT =
  "请在设置中打开「API 配置向导」填写模型 API Key（保存到本机模型设置文件）。";

const CODE_HINTS: Record<string, string> = {
  missing_api_key: MODEL_NOT_CONFIGURED_USER_HINT,
  missing_provider_api_key:
    "当前所选模型的服务商尚未配置 Key。请打开 API 配置向导填写对应服务商密钥，或添加自定义模型。",
  invalid_api_token:
    "本机服务鉴权失败（与模型 API Key 无关）。请完全退出并重启 LawMind 桌面端后再试。",
  invalid_matter_id:
    "案件 ID 格式不正确。请使用字母或数字开头，2–128 字符，仅含字母、数字、点、下划线、连字符。",
  message_required: "请输入有效内容后再发送。",
  invalid_matter_id_chat: "当前关联的案件 ID 无效，请清空或更正后再试。",
  session_assistant_mismatch: "该会话属于其他助手，请新开对话或清空会话后重试。",
  approval_already_resolved: "该审批已被处理，请刷新待办后查看最新状态。",
  model_unavailable: "模型暂时不可用。请检查 API Key、账户状态与网络连接。",
  model_network_error: "无法连接模型服务。请检查 Base URL、本机网络/代理，或在设置中测试模型连接。",
  missing_platform_api_key: "平台模型未开通。请使用 API 配置向导自备 Key，或联系管理员配置平台模型。",
};

const MODEL_ERROR_CODES = new Set(["model_unavailable", "model_network_error"]);

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
  if (typeof body.hint === "string" && body.hint.trim()) {
    push(body.hint.trim());
  }
  const joined = chunks.join(" — ");
  if (MODEL_ERROR_CODES.has(code)) {
    if (joined) {
      return friendlyModelErrorMessage(joined);
    }
    return CODE_HINTS[code] ?? "模型暂时不可用。请检查 API Key、账户状态与网络连接。";
  }
  if (joined && isModelProviderErrorMessage(joined)) {
    return friendlyModelErrorMessage(joined);
  }
  const statusHint =
    status === 404
      ? "未找到资源"
      : status === 408 || status === 504
        ? "请求超时"
        : status === 429
          ? "请求过于频繁"
          : status >= 500
            ? "服务暂时不可用"
            : status >= 400
              ? "请求未成功"
              : "请求失败";
  const base = joined || statusHint;
  const hint = code && CODE_HINTS[code] ? CODE_HINTS[code] : "";
  if (code === "invalid_api_token") {
    return hint;
  }
  if (status === 503 || status === 502) {
    return hint || `${base} 请检查 API Key、网络与本地服务是否正常。`;
  }
  if (status === 401 || status === 403) {
    return hint || `${base} 请检查 API Key 是否有效、是否过期。`;
  }
  if (
    status === 409 &&
    (code === "session_assistant_mismatch" || code === "approval_already_resolved")
  ) {
    return hint ? `${base} ${hint}` : base;
  }
  return hint ? `${base} ${hint}` : base;
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
        ? `服务返回了无法识别的内容：${snippet}${tail}`
        : "服务返回了无法识别的内容，请稍后重试或检查本地服务。",
      null,
    );
  }
}

export function isModelFailureError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    const code = typeof error.body?.code === "string" ? error.body.code : "";
    if (MODEL_ERROR_CODES.has(code)) {
      return true;
    }
    return isModelProviderErrorMessage(error.message);
  }
  if (error instanceof Error) {
    return isModelProviderErrorMessage(error.message);
  }
  return false;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    const msg = error.message.trim();
    if (!msg) {
      return fallback;
    }
    if (isModelFailureError(error)) {
      return friendlyModelErrorMessage(msg);
    }
    // 不落工程师前缀 [HTTP N]：状态码并入中文语境。
    if (
      error.status >= 400 &&
      !msg.includes("服务暂时不可用") &&
      !msg.includes("请求未成功") &&
      !msg.includes(`HTTP ${error.status}`) &&
      !msg.includes("无法识别的内容") &&
      !msg.includes(`无法解析 JSON`)
    ) {
      return `${msg}（服务返回 ${error.status}）`;
    }
    return msg;
  }
  if (error instanceof Error && error.message.trim()) {
    const msg = error.message.trim();
    if (isModelProviderErrorMessage(msg)) {
      return friendlyModelErrorMessage(msg);
    }
    return msg;
  }
  return fallback;
}

export type ProxyFetchOptions = {
  /** 单次超时（毫秒），默认 30 秒。0 表示不额外加超时。 */
  timeoutMs?: number;
  /** 额外重试次数（默认 1 次），仅对网络错误/超时/502/503 生效。 */
  maxRetries?: number;
  /** 是否跳过写入审计事件（用于审计事件本身，避免递归）。 */
  skipAudit?: boolean;
  /** 是否允许非本地 http://（默认 false）。 */
  allowInsecure?: boolean;
  /** 是否允许非本地 https:// 外部域名（默认 false）。 */
  allowExternal?: boolean;
  /** 请求标签，用于日志和审计 detail。 */
  tag?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (LOCAL_HOSTNAMES.has(h)) {
    return true;
  }
  if (h.startsWith("127.")) {
    const parts = h.split(".").map(Number);
    return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  }
  return false;
}

function assertUrlAllowed(url: URL, opts: ProxyFetchOptions): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiRequestError(0, `不支持的协议：${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new ApiRequestError(0, "URL 中禁止嵌入凭据");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && !isLoopbackHost(host) && !opts.allowInsecure) {
    throw new ApiRequestError(
      0,
      "非本地 http 明文请求已被阻止。如需访问，请在设置中显式允许或改用本地 API 代理。",
    );
  }
  if (url.protocol === "https:" && !isLoopbackHost(host) && !opts.allowExternal) {
    throw new ApiRequestError(
      0,
      "外部 https 请求已被阻止。敏感 API 调用应通过本地引擎侧统一出口代理完成。",
    );
  }
}

let resolvedDefaultApiBase: string | null = null;
let resolvedDefaultApiBaseTs = 0;
const API_BASE_CACHE_TTL_MS = 500;

/** 返回当前生效的本地 API base URL（兜底开发端口，bootstrap 后由 auth 模块刷新）。 */
export function resolveDefaultApiBase(): string {
  const now = Date.now();
  if (resolvedDefaultApiBase && now - resolvedDefaultApiBaseTs < API_BASE_CACHE_TTL_MS) {
    return resolvedDefaultApiBase;
  }
  const fallback = "http://127.0.0.1:4799";
  resolvedDefaultApiBase = fallback;
  resolvedDefaultApiBaseTs = now;
  return fallback;
}

function resolveFetchUrl(input: string | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string" && (input.startsWith("http://") || input.startsWith("https://"))) {
    return new URL(input);
  }
  if (typeof input === "string" && input.startsWith("/")) {
    return new URL(input, resolveDefaultApiBase());
  }
  return new URL(input, resolveDefaultApiBase());
}

function adoptResolvedDefaultApiBase(apiBase: string): void {
  resolvedDefaultApiBase = apiBase.replace(/\/$/, "");
  resolvedDefaultApiBaseTs = Date.now();
}

function rewriteLoopbackUrl(current: URL, nextBase: string): URL {
  const next = new URL(current.href);
  const parsed = new URL(nextBase);
  next.protocol = parsed.protocol;
  next.host = parsed.host;
  return next;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof ApiRequestError) {
    return err.status === 408 || err.status === 504 || isRetryableStatus(err.status);
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return false; // 主动取消不重试
  }
  if (err instanceof TypeError) {
    // fetch 网络错误（如连接被拒绝、DNS 失败）通常表现为 TypeError。
    return true;
  }
  return false;
}

function mergeHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const auth = apiAuthHeaders();
  if (auth.authorization && !headers.has("authorization")) {
    headers.set("authorization", auth.authorization);
  }
  return headers;
}

function computeRetryDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}

export type OutboundAuditDetail = {
  method: string;
  host: string;
  pathname: string;
  status: number | string;
  durationMs: number;
  tag?: string;
  error?: string;
};

function buildAuditDetail(
  url: URL,
  method: string,
  status: number | string,
  durationMs: number,
  tag?: string,
  error?: string,
): string {
  const detail: OutboundAuditDetail = {
    method,
    host: url.hostname,
    pathname: url.pathname,
    status,
    durationMs,
  };
  if (tag) {
    detail.tag = tag;
  }
  if (error) {
    detail.error = error.slice(0, 200);
  }
  return JSON.stringify(detail);
}

let auditEnabled = !(typeof process !== "undefined" && process.env.VITEST);

/** 测试/开发：临时关闭或开启审计事件发送，避免测试 mock 被审计 fetch 消耗。 */
export function setAuditEnabledForTests(enabled: boolean): void {
  auditEnabled = enabled;
}

/** 审计事件发送：使用原生 fetch 直连本地 API，避免代理递归。 */
async function sendOutboundAuditEvent(
  baseUrl: string,
  method: string,
  url: URL,
  status: number | string,
  durationMs: number,
  tag?: string,
  error?: string,
): Promise<void> {
  if (!auditEnabled) {
    return;
  }
  try {
    const auth = apiAuthHeaders();
    const body = JSON.stringify({
      kind: "outbound_http",
      taskId: "renderer",
      actor: "lawyer",
      detail: buildAuditDetail(url, method, status, durationMs, tag, error),
    });
    void fetch(`${baseUrl.replace(/\/$/, "")}/api/audit/event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth.authorization ? { authorization: auth.authorization } : {}),
      },
      body,
    });
  } catch {
    /* 审计为尽力而为，失败不阻塞业务 */
  }
}

async function performFetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  // 流式/长轮询请求（如 SSE）不需要代理层超时；直接把调用方 signal 传给 fetch，
  // 这样调用方 abort 时能取消响应 body 读取，避免代理层 wrapper 在 fetch 完成后移除 listener 导致无法中断流式读取。
  if (timeoutMs <= 0 && init.signal) {
    return fetch(url.href, init);
  }
  const controller = new AbortController();
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new DOMException("请求超时", "AbortError")),
          timeoutMs,
        )
      : undefined;
  const mergedSignal = init.signal;
  const onAbort = () => controller.abort();
  if (mergedSignal) {
    if (mergedSignal.aborted) {
      controller.abort();
    } else {
      mergedSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  try {
    return await fetch(url.href, { ...init, signal: controller.signal });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (mergedSignal) {
      mergedSignal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * 统一 fetch 出口。所有 renderer HTTP 请求应经此函数。
 *
 * - 自动注入本地 API Bearer（除非已显式传入 authorization）
 * - 自动解析 base URL（支持相对路径、完整 URL、本地 API base）
 * - 默认拒绝非本地 http 与外部域名
 * - 超时、重试、日志、审计
 */
export async function fetchApi(
  input: string | URL,
  init: RequestInit = {},
  opts: ProxyFetchOptions = {},
): Promise<Response> {
  let url = resolveFetchUrl(input);
  assertUrlAllowed(url, opts);

  const method = (init.method || "GET").toUpperCase();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const tag = opts.tag;

  const started = Date.now();
  let lastError: Error | undefined;
  let loopbackAdopted = false;

  const runOnce = async (): Promise<Response> => {
    const headers = mergeHeaders(init.headers);
    return performFetchWithTimeout(url, { ...init, headers, method }, timeoutMs);
  };

  let finalResponse: Response | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const baseUrl = `${url.protocol}//${url.host}`;
    try {
      const response = await runOnce();
      const durationMs = Date.now() - started;
      // 只记录 method、path、status，不记录 body。
      console.info(
        `[renderer:fetch] ${method} ${url.pathname} ${response.status} (${durationMs}ms)`,
      );
      if (!opts.skipAudit) {
        void sendOutboundAuditEvent(baseUrl, method, url, response.status, durationMs, tag);
      }
      finalResponse = response;
      if (attempt >= maxRetries || !isRetryableStatus(response.status)) {
        return response;
      }
      // 5xx / 429 时指数退避后重试。
      await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - started;
      const errorMsg = lastError.message.slice(0, 200);
      console.info(
        `[renderer:fetch] ${method} ${url.pathname} error (${durationMs}ms): ${errorMsg}`,
      );
      if (!opts.skipAudit) {
        void sendOutboundAuditEvent(baseUrl, method, url, "error", durationMs, tag, errorMsg);
      }
      if (
        !loopbackAdopted &&
        isRetryableError(err) &&
        isLoopbackHost(url.hostname)
      ) {
        const fresh = await refreshLoopbackAuthFromDesktop();
        if (fresh?.apiBase) {
          url = rewriteLoopbackUrl(url, fresh.apiBase);
          adoptResolvedDefaultApiBase(fresh.apiBase);
          loopbackAdopted = true;
          continue;
        }
      }
      if (attempt >= maxRetries || !isRetryableError(err)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  if (lastError instanceof ApiRequestError) {
    throw lastError;
  }
  if (lastError instanceof DOMException && lastError.name === "AbortError") {
    throw new ApiRequestError(0, "请求超时，请稍后重试或检查本地服务。");
  }
  if (lastError instanceof TypeError) {
    throw new ApiRequestError(
      0,
      "无法连接本地服务，请检查网络与本机 LawMind 进程是否运行。",
    );
  }
  throw lastError ?? new ApiRequestError(0, "未知请求失败");
}

/**
 * 便捷函数：经代理 fetch 后读取 JSON。
 * 适合需要自定义 signal/body 的调用点（如聊天会话、SSE 订阅）。
 */
export async function fetchApiJson<T>(
  input: string | URL,
  init?: RequestInit,
  opts?: ProxyFetchOptions,
): Promise<T & ApiErrorJson> {
  const res = await fetchApi(input, init, opts);
  return readJsonFromResponse<T>(res);
}

/** 测试/开发：重置默认 base URL 缓存。 */
export function setDefaultApiBaseForTests(base: string | null): void {
  resolvedDefaultApiBase = base;
  resolvedDefaultApiBaseTs = base ? Date.now() : 0;
}

/** 测试/开发：重置 loopback token 缓存。 */
export function setLoopbackApiAuthTokenForTests(token: string | null): void {
  setLoopbackApiAuthToken(token);
}

/** 导出当前 token，便于测试断言。 */
export function getLoopbackApiAuthTokenForTests(): string | null {
  return getLoopbackApiAuthToken();
}
