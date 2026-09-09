/**
 * Parse LawMind local API error responses for display hints (chat retry guidance).
 *
 * 实现已迁移至 api-client-proxy.ts：本文件保留 loopback 401 重试逻辑与
 * apiGetJson / apiSendJson 兼容签名，并 re-export 代理层的错误与工具函数。
 */

import { refreshLoopbackAuthFromDesktop } from "./lawmind-dev-config-cache.ts";
import {
  ApiRequestError,
  type ApiErrorJson,
  fetchApi,
  type ProxyFetchOptions,
  readJsonFromResponse,
  userMessageFromApiError,
} from "./api-client-proxy.ts";

export {
  ApiRequestError,
  type ApiErrorJson,
  chatErrorUserText,
  errorMessage,
  fetchApi,
  type OutboundAuditDetail,
  type ProxyFetchOptions,
  isModelFailureError,
  messageFromOkFalseBody,
  MODEL_NOT_CONFIGURED_USER_HINT,
  readJsonFromResponse,
  userMessageFromApiError,
  setDefaultApiBaseForTests,
  setLoopbackApiAuthTokenForTests,
  getLoopbackApiAuthTokenForTests,
} from "./api-client-proxy.ts";

function isLoopbackAuthFailure(status: number, body: ApiErrorJson): boolean {
  return status === 401 && (body.code === "invalid_api_token" || body.error === "unauthorized");
}

async function maybeRetryLoopbackAuth(): Promise<{ apiBase: string } | null> {
  const fresh = await refreshLoopbackAuthFromDesktop();
  if (!fresh) {
    return null;
  }
  return { apiBase: fresh.apiBase.replace(/\/$/, "") };
}

/** Re-issue a loopback fetch after Electron hands over a new port/token. */
export async function fetchWithLoopbackAuthRetry(
  apiBase: string,
  run: (base: string) => Promise<Response>,
): Promise<{ response: Response; apiBase: string }> {
  const startBase = apiBase.replace(/\/$/, "");
  const response = await run(startBase);
  if (response.status !== 401) {
    return { response, apiBase: startBase };
  }
  const nextBase = await maybeRetryLoopbackAuth();
  if (!nextBase) {
    return { response, apiBase: startBase };
  }
  return { response: await run(nextBase.apiBase), apiBase: nextBase.apiBase };
}

export async function apiGetJson<T>(apiBase: string, path: string): Promise<T> {
  const run = (base: string) => fetchApi(`${base}${path}`, {}, { tag: "apiGetJson" });
  let response = await run(apiBase);
  let body = await readJsonFromResponse<T>(response);
  if (!response.ok && isLoopbackAuthFailure(response.status, body)) {
    const nextBase = await maybeRetryLoopbackAuth();
    if (nextBase) {
      response = await run(nextBase.apiBase);
      body = await readJsonFromResponse<T>(response);
    }
  }
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
  const run = (base: string) =>
    fetchApi(
      `${base}${path}`,
      {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      { tag: "apiSendJson" },
    );
  let response = await run(apiBase);
  let responseBody = await readJsonFromResponse<TResponse>(response);
  if (!response.ok && isLoopbackAuthFailure(response.status, responseBody)) {
    const nextBase = await maybeRetryLoopbackAuth();
    if (nextBase) {
      response = await run(nextBase.apiBase);
      responseBody = await readJsonFromResponse<TResponse>(response);
    }
  }
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      userMessageFromApiError(response.status, responseBody),
      responseBody,
    );
  }
  return responseBody;
}
