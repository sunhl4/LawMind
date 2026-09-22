/**
 * 统一 HTTP 出口代理（Outbound Proxy）
 *
 * 引擎侧所有向外 HTTP 请求（MCP HTTP、URL dossier、模型 API、检索 provider）
 * 应通过本代理，集中处理：
 *   - URL 规范化与 SSRF 二次校验
 *   - 非本地 http 默认拒绝，与本机 http/https 例外可控
 *   - 超时 / 重试统一
 *   - 代理环境变量（HTTP_PROXY / HTTPS_PROXY / NO_PROXY）遵循
 *   - 根证书注入（需走 node 原生请求路径时生效）
 *   - 审计日志（outbound_http，不含请求体/响应体）
 *
 * 注意：本代理不直接依赖 Electron，headless/CLI 可直接使用；
 * Electron 侧通过环境变量注入代理与根证书设置。
 */

import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { PassThrough, Readable } from "node:stream";
import tls from "node:tls";
import { URL } from "node:url";
import { emit } from "../audit/index.js";
import { computeRetryDelayMs, isRetryableHttpFailure } from "../llm/http-retry.js";
import type { AuditEvent } from "../types.js";

export type OutboundProxyOptions = {
  /** 底层 fetch 实现；未提供时优先使用 global fetch，代理/根证书场景走 node 原生请求。 */
  fetchImpl?: typeof fetch;
  /** 是否允许非本地 http://（默认 false）。 */
  allowInsecure?: boolean;
  /** 是否允许本机/私网地址（默认 true，因桌面版需要 localhost）。 */
  allowLocalNetwork?: boolean;
  /** 额外 SSRF 主机黑名单（默认已含常见云元数据地址）。 */
  blockedHostnames?: string[];
  /** 是否遵循 HTTP_PROXY / HTTPS_PROXY / NO_PROXY（默认 true）。 */
  proxyEnv?: boolean;
  /** 额外根证书 PEM 内容（仅 node 原生路径生效）。 */
  rootCerts?: string[];
  /** 审计目录；未提供时不写审计。 */
  auditDir?: string;
  /** 审计事件 taskId（默认 "system"）。 */
  taskId?: string;
  /** 审计 actor（默认 "system"）。 */
  actor?: AuditEvent["actor"];
  actorId?: string;
  /** 请求标签，便于在审计 detail 中区分调用方。 */
  requestTag?: string;
  /** 默认单次超时（ms）；0 表示不额外加超时。 */
  timeoutMs?: number;
  /** 额外重试次数（默认 0，避免与上层重试叠加）。 */
  maxRetries?: number;
  /** 响应体上限（默认 8MB，仅 node 原生路径生效）。 */
  maxResponseBytes?: number;
  /** 重定向策略（语义 follow，实现为逐跳 manual 校验）。 */
  redirect?: NonNullable<RequestInit["redirect"]>;
  /** 测试注入 DNS；生产默认 lookup。 */
  dnsLookup?: OutboundDnsLookupFn;
};

export type OutboundDnsLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family?: number }>>;

const DEFAULT_BLOCKED_HOSTNAMES = [
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.aws.internal",
  "169.254.169.254",
];

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 10;

export class OutboundProxyError extends Error {
  readonly name = "OutboundProxyError";
}

export type OutboundProxy = {
  fetch(input: Parameters<typeof fetch>[0] | URL, init?: RequestInit): Promise<Response>;
};

type ResolvedOptions = Required<
  Pick<
    OutboundProxyOptions,
    | "allowInsecure"
    | "allowLocalNetwork"
    | "proxyEnv"
    | "timeoutMs"
    | "maxRetries"
    | "maxResponseBytes"
    | "redirect"
  >
> & {
  fetchImpl?: typeof fetch;
  blockedHostnames: string[];
  rootCerts?: string[];
  auditDir?: string;
  taskId: string;
  actor: AuditEvent["actor"];
  actorId?: string;
  requestTag?: string;
  dnsLookup?: OutboundDnsLookupFn;
};

function isIpv4Literal(host: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) &&
    host.split(".").every((n) => {
      const x = Number(n);
      return Number.isInteger(x) && x >= 0 && x <= 255;
    })
  );
}

function isIpv6Literal(host: string): boolean {
  return net.isIP(host) === 6;
}

function normalizeIpv6(host: string): string {
  return host.toLowerCase().replace(/^\[|\]$/g, "");
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (isIpv4Literal(h)) {
    const [a] = h.split(".").map(Number);
    return a === 127;
  }
  return false;
}

function hostMatchesBlocked(host: string, blocked: string): boolean {
  const h = host.toLowerCase();
  const b = blocked.toLowerCase();
  if (h === b) {
    return true;
  }
  if (b.startsWith(".")) {
    return h === b.slice(1) || h.endsWith(b);
  }
  return h.endsWith(`.${b}`);
}

function denyReasonForIpv4(host: string, allowLocalNetwork: boolean): string | null {
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  if (a === 0) {
    return `SSRF 拒绝 0.0.0.0/8 地址「${host}」`;
  }
  if (a === 127 && !allowLocalNetwork) {
    return `SSRF 拒绝 loopback 地址「${host}」`;
  }
  if (a === 10 && !allowLocalNetwork) {
    return `SSRF 拒绝私网地址「${host}」`;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return `SSRF 拒绝共享地址空间「${host}」`;
  }
  if (a === 172 && b >= 16 && b <= 31 && !allowLocalNetwork) {
    return `SSRF 拒绝私网地址「${host}」`;
  }
  if (a === 192 && b === 168 && !allowLocalNetwork) {
    return `SSRF 拒绝私网地址「${host}」`;
  }
  if (a === 169 && b === 254) {
    return `SSRF 拒绝 link-local 地址「${host}」`;
  }
  return null;
}

function denyReasonForIpv6(host: string, allowLocalNetwork: boolean): string | null {
  const h = normalizeIpv6(host);
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return allowLocalNetwork ? null : `SSRF 拒绝 loopback 地址「${host}」`;
  }
  if (h.startsWith("fe80:") || h.startsWith("fe")) {
    return `SSRF 拒绝 link-local 地址「${host}」`;
  }
  if (h.startsWith("fc") || h.startsWith("fd")) {
    return allowLocalNetwork ? null : `SSRF 拒绝私网 IPv6「${host}」`;
  }
  if (h.startsWith("::ffff:")) {
    const mapped = h.slice("::ffff:".length);
    if (isIpv4Literal(mapped)) {
      return denyReasonForIpv4(mapped, allowLocalNetwork);
    }
  }
  return null;
}

function assertUrlAllowed(url: URL, opts: ResolvedOptions): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundProxyError(`不支持的协议：${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new OutboundProxyError("URL 中禁止嵌入凭据");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && !isLoopbackHost(host) && !opts.allowInsecure) {
    throw new OutboundProxyError("非本地 http 默认拒绝；如需明文请设置 allowInsecure=true");
  }
  for (const blocked of opts.blockedHostnames) {
    if (hostMatchesBlocked(host, blocked)) {
      throw new OutboundProxyError(`SSRF 黑名单主机：${host}`);
    }
  }
  if (isIpv4Literal(host)) {
    const reason = denyReasonForIpv4(host, opts.allowLocalNetwork);
    if (reason) {
      throw new OutboundProxyError(reason);
    }
  } else if (isIpv6Literal(host)) {
    const reason = denyReasonForIpv6(host, opts.allowLocalNetwork);
    if (reason) {
      throw new OutboundProxyError(reason);
    }
  }
}

async function defaultOutboundDnsLookup(
  hostname: string,
): Promise<Array<{ address: string; family?: number }>> {
  if (process.env.VITEST === "true") {
    void hostname;
    return [{ address: "203.0.113.10", family: 4 }];
  }
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function denyReasonForResolvedAddress(address: string, allowLocalNetwork: boolean): string | null {
  const host = address.trim().toLowerCase();
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    if (isIpv4Literal(mapped)) {
      return denyReasonForIpv4(mapped, allowLocalNetwork);
    }
  }
  if (isIpv4Literal(host)) {
    return denyReasonForIpv4(host, allowLocalNetwork);
  }
  if (host.includes(":")) {
    return denyReasonForIpv6(host, allowLocalNetwork);
  }
  return `SSRF 解析地址「${address}」无法识别`;
}

async function assertProxyHopAllowed(proxyUrl: URL, opts: ResolvedOptions): Promise<void> {
  if (proxyUrl.protocol !== "http:") {
    throw new OutboundProxyError("仅支持 http 代理；https 代理尚未实现");
  }
  if (proxyUrl.username || proxyUrl.password) {
    throw new OutboundProxyError("代理 URL 中禁止嵌入凭据");
  }
  const host = proxyUrl.hostname.toLowerCase();
  if (isIpv4Literal(host)) {
    const reason = denyReasonForIpv4(host, opts.allowLocalNetwork);
    if (reason) {
      throw new OutboundProxyError(`代理地址不可达：${reason}`);
    }
  } else if (isIpv6Literal(host)) {
    const reason = denyReasonForIpv6(host, opts.allowLocalNetwork);
    if (reason) {
      throw new OutboundProxyError(`代理地址不可达：${reason}`);
    }
  }
  await assertResolvedAddressesAllowed(proxyUrl, opts);
}

async function assertResolvedAddressesAllowed(url: URL, opts: ResolvedOptions): Promise<void> {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIpv4Literal(host) || isIpv6Literal(host) || isLoopbackHost(host)) {
    return;
  }
  const lookup = opts.dnsLookup ?? defaultOutboundDnsLookup;
  let addrs: Array<{ address: string; family?: number }>;
  try {
    addrs = await lookup(host);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new OutboundProxyError(`主机「${host}」DNS 解析失败（fail-closed）：${detail}`);
  }
  if (!addrs.length) {
    throw new OutboundProxyError(`主机「${host}」DNS 无解析结果（fail-closed）`);
  }
  for (const row of addrs) {
    const reason = denyReasonForResolvedAddress(row.address, opts.allowLocalNetwork);
    if (reason) {
      throw new OutboundProxyError(`主机「${host}」解析到不可达地址：${reason}`);
    }
  }
}

function parseUrl(input: Parameters<typeof fetch>[0] | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function mergeInit(input: Parameters<typeof fetch>[0] | URL, init?: RequestInit): RequestInit {
  if (input instanceof Request) {
    const merged: RequestInit = {
      method: input.method,
      headers: input.headers,
      body: input.body,
      ...init,
    };
    return merged;
  }
  return init ?? {};
}

function envProxyUrl(protocol: "http" | "https"): string | undefined {
  const name = protocol === "https" ? "HTTPS_PROXY" : "HTTP_PROXY";
  const value = process.env[name] || process.env[name.toLowerCase()];
  return value?.trim() || undefined;
}

function noProxyEntries(): string[] {
  const raw = process.env.NO_PROXY || process.env.no_proxy || "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function shouldUseProxyForHost(host: string, proxyUrl: string | undefined): boolean {
  if (!proxyUrl) {
    return false;
  }
  const h = host.toLowerCase();
  for (const entry of noProxyEntries()) {
    if (entry === h) {
      return false;
    }
    if (entry.startsWith(".")) {
      if (h === entry.slice(1) || h.endsWith(entry)) {
        return false;
      }
    } else if (h.endsWith(`.${entry}`)) {
      return false;
    }
  }
  return true;
}

function selectProxyUrl(url: URL, opts: ResolvedOptions): string | undefined {
  if (!opts.proxyEnv) {
    return undefined;
  }
  const proxy = url.protocol === "https:" ? envProxyUrl("https") : envProxyUrl("http");
  if (!proxy) {
    return undefined;
  }
  if (!shouldUseProxyForHost(url.hostname, proxy)) {
    return undefined;
  }
  return proxy;
}

function headersToRecord(headers: Headers): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  headers.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  });
  return out;
}

function proxyAuthorization(proxyUrl: URL): string | undefined {
  if (!proxyUrl.username && !proxyUrl.password) {
    return undefined;
  }
  const user = decodeURIComponent(proxyUrl.username);
  const pass = decodeURIComponent(proxyUrl.password);
  const token = Buffer.from(`${user}:${pass}`).toString("base64");
  return `Basic ${token}`;
}

function writeBody(req: http.ClientRequest, body: RequestInit["body"] | null | undefined): void {
  if (!body) {
    return;
  }
  if (typeof body === "string") {
    req.write(body);
  } else if (body instanceof Uint8Array) {
    req.write(body);
  } else if (body instanceof ArrayBuffer) {
    req.write(Buffer.from(body));
  }
  // 其他类型（ReadableStream 等）在当前场景下无需支持；需要时由调用方自行传入 fetchImpl。
}

function responseFromIncomingMessage(res: http.IncomingMessage, maxBytes: number): Response {
  const status = res.statusCode ?? 0;
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers)) {
    if (typeof key !== "string") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) {
          headers.append(key, item);
        }
      }
    } else if (value != null) {
      headers.set(key, String(value));
    }
  }
  if (maxBytes > 0) {
    const pt = new PassThrough();
    let received = 0;
    res.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes && !pt.destroyed) {
        pt.destroy(new Error(`outbound_response_too_large:>${maxBytes}`));
        res.destroy();
        return;
      }
      pt.write(chunk);
    });
    res.on("end", () => pt.end());
    res.on("error", (err) => pt.destroy(err));
    return new Response(Readable.toWeb(pt) as unknown as ReadableStream<Uint8Array>, {
      status,
      headers,
    });
  }
  return new Response(Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}

function setupAbort(
  req: http.ClientRequest,
  controller: AbortController,
  onError: (err: Error) => void,
): () => void {
  const onAbort = () => {
    try {
      req.destroy();
    } catch {
      /* ignore */
    }
  };
  controller.signal.addEventListener("abort", onAbort, { once: true });
  req.on("error", (err) => {
    controller.signal.removeEventListener("abort", onAbort);
    onError(err);
  });
  return () => controller.signal.removeEventListener("abort", onAbort);
}

function directRequest(
  url: URL,
  method: string,
  headers: Headers,
  body: RequestInit["body"] | null | undefined,
  ca: Buffer | undefined,
  controller: AbortController,
  maxBytes: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
    const options = {
      hostname: url.hostname,
      port,
      path: url.pathname + url.search,
      method,
      headers: headersToRecord(headers),
      ...(isHttps ? { servername: url.hostname, ca } : {}),
    };
    const req = isHttps
      ? https.request(options as https.RequestOptions, (res) => finish(res))
      : http.request(options as http.RequestOptions, (res) => finish(res));
    const cleanup = setupAbort(req, controller, reject);
    const finish = (res: http.IncomingMessage) => {
      cleanup();
      resolve(responseFromIncomingMessage(res, maxBytes));
    };
    writeBody(req, body);
    req.end();
  });
}

function httpOverProxyRequest(
  targetUrl: URL,
  proxyUrl: URL,
  method: string,
  headers: Headers,
  body: RequestInit["body"] | null | undefined,
  ca: Buffer | undefined,
  controller: AbortController,
  maxBytes: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const port = proxyUrl.port ? Number(proxyUrl.port) : 80;
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has("Host")) {
      requestHeaders.set("Host", targetUrl.host);
    }
    const auth = proxyAuthorization(proxyUrl);
    if (auth) {
      requestHeaders.set("Proxy-Authorization", auth);
    }
    const options = {
      hostname: proxyUrl.hostname,
      port,
      path: targetUrl.href,
      method,
      headers: headersToRecord(requestHeaders),
    };
    const req = http.request(options as http.RequestOptions, (res) => {
      cleanup();
      resolve(responseFromIncomingMessage(res, maxBytes));
    });
    const cleanup = setupAbort(req, controller, reject);
    writeBody(req, body);
    req.end();
  });
}

function httpsOverProxyRequest(
  targetUrl: URL,
  proxyUrl: URL,
  method: string,
  headers: Headers,
  body: RequestInit["body"] | null | undefined,
  ca: Buffer | undefined,
  controller: AbortController,
  maxBytes: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const proxyPort = proxyUrl.port ? Number(proxyUrl.port) : 80;
    const targetPort = targetUrl.port ? Number(targetUrl.port) : 443;
    const connectHeaders: Record<string, string> = {
      Host: `${targetUrl.hostname}:${targetPort}`,
    };
    const auth = proxyAuthorization(proxyUrl);
    if (auth) {
      connectHeaders["Proxy-Authorization"] = auth;
    }
    const proxyReq = http.request({
      hostname: proxyUrl.hostname,
      port: proxyPort,
      method: "CONNECT",
      path: `${targetUrl.hostname}:${targetPort}`,
      headers: connectHeaders,
    });
    let settled = false;
    const finish = (err?: Error, res?: Response) => {
      if (settled) {
        return;
      }
      settled = true;
      if (err) {
        reject(err);
      } else if (res) {
        resolve(res);
      }
    };
    const onAbort = () => {
      try {
        proxyReq.destroy();
      } catch {
        /* ignore */
      }
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    proxyReq.on("error", (err) => {
      controller.signal.removeEventListener("abort", onAbort);
      finish(err);
    });
    proxyReq.on("connect", (proxyRes, socket) => {
      controller.signal.removeEventListener("abort", onAbort);
      if (proxyRes.statusCode !== 200) {
        finish(new Error(`代理 CONNECT 失败：HTTP ${proxyRes.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({
        host: targetUrl.hostname,
        servername: targetUrl.hostname,
        socket,
        ca,
      });
      tlsSocket.on("error", (err) => finish(err));
      tlsSocket.once("secureConnect", () => {
        const requestOptions: https.RequestOptions = {
          hostname: targetUrl.hostname,
          port: targetPort,
          path: targetUrl.pathname + targetUrl.search,
          method,
          headers: headersToRecord(headers),
          servername: targetUrl.hostname,
          ca,
          createConnection: () => tlsSocket,
        };
        const req = https.request(requestOptions, (res) =>
          finish(undefined, responseFromIncomingMessage(res, maxBytes)),
        );
        req.on("error", (err) => finish(err));
        const innerAbort = () => {
          try {
            req.destroy();
          } catch {
            /* ignore */
          }
        };
        controller.signal.addEventListener("abort", innerAbort, { once: true });
        writeBody(req, body);
        req.end();
      });
    });
    proxyReq.end();
  });
}

function nodeRequest(
  url: URL,
  init: RequestInit | undefined,
  opts: ResolvedOptions,
): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const headers = new Headers(init?.headers);
  const body = init?.body;
  const ca = opts.rootCerts?.length ? Buffer.from(opts.rootCerts.join("\n")) : undefined;

  const controller = new AbortController();
  const timer =
    opts.timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new DOMException("请求超时", "AbortError")),
          opts.timeoutMs,
        )
      : undefined;
  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  const proxyUrlStr = selectProxyUrl(url, opts);
  const run = async (): Promise<Response> => {
    if (!proxyUrlStr) {
      return directRequest(url, method, headers, body, ca, controller, opts.maxResponseBytes);
    }
    const proxyUrl = new URL(proxyUrlStr);
    await assertProxyHopAllowed(proxyUrl, opts);
    if (url.protocol === "http:") {
      return httpOverProxyRequest(
        url,
        proxyUrl,
        method,
        headers,
        body,
        ca,
        controller,
        opts.maxResponseBytes,
      );
    }
    return httpsOverProxyRequest(
      url,
      proxyUrl,
      method,
      headers,
      body,
      ca,
      controller,
      opts.maxResponseBytes,
    );
  };

  return run().finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function shouldFollowRedirect(
  status: number,
  redirect: NonNullable<RequestInit["redirect"]>,
): boolean {
  return redirect === "follow" && status >= 300 && status < 400;
}

function buildAuditDetail(
  opts: ResolvedOptions,
  url: URL,
  method: string,
  status: number | string,
  durationMs: number,
  error?: string,
): string {
  const payload: Record<string, unknown> = {
    method,
    host: url.hostname,
    pathname: url.pathname,
    status,
    durationMs,
  };
  if (opts.requestTag) {
    payload.tag = opts.requestTag;
  }
  if (error) {
    payload.error = error.slice(0, 200);
  }
  return JSON.stringify(payload);
}

async function auditEvent(
  opts: ResolvedOptions,
  url: URL,
  method: string,
  status: number | string,
  durationMs: number,
  error?: string,
): Promise<void> {
  if (!opts.auditDir) {
    return;
  }
  await emit(opts.auditDir, {
    taskId: opts.taskId,
    kind: "outbound_http",
    actor: opts.actor,
    actorId: opts.actorId,
    detail: buildAuditDetail(opts, url, method, status, durationMs, error),
  }).catch(() => undefined);
}

export function createOutboundProxy(options: OutboundProxyOptions = {}): OutboundProxy {
  const opts: ResolvedOptions = {
    allowInsecure: options.allowInsecure ?? false,
    allowLocalNetwork: options.allowLocalNetwork ?? true,
    blockedHostnames: [...DEFAULT_BLOCKED_HOSTNAMES, ...(options.blockedHostnames ?? [])],
    proxyEnv: options.proxyEnv ?? true,
    timeoutMs: options.timeoutMs ?? 0,
    maxRetries: options.maxRetries ?? 0,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    redirect: options.redirect ?? "follow",
    fetchImpl: options.fetchImpl,
    rootCerts: options.rootCerts,
    auditDir: options.auditDir,
    taskId: options.taskId ?? "system",
    actor: options.actor ?? "system",
    actorId: options.actorId,
    requestTag: options.requestTag,
    dnsLookup: options.dnsLookup,
  };

  const needsNodeFetch = () => {
    if (opts.fetchImpl) {
      return false;
    }
    if (opts.rootCerts && opts.rootCerts.length > 0) {
      return true;
    }
    if (!opts.proxyEnv) {
      return false;
    }
    return Boolean(envProxyUrl("http") || envProxyUrl("https"));
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = parseUrl(input);
    const mergedInit = mergeInit(input, init);
    assertUrlAllowed(url, opts);
    await assertResolvedAddressesAllowed(url, opts);

    const started = Date.now();
    const method = mergedInit.method?.toUpperCase() ?? "GET";
    const redirect =
      (mergedInit.redirect as NonNullable<RequestInit["redirect"]> | undefined) ?? opts.redirect;
    let lastError: Error | undefined;

    const attemptOnce = async (target: URL, requestInit: RequestInit): Promise<Response> => {
      assertUrlAllowed(target, opts);
      await assertResolvedAddressesAllowed(target, opts);
      if (needsNodeFetch()) {
        return nodeRequest(target, requestInit, opts);
      }
      const controller = new AbortController();
      const timer =
        opts.timeoutMs > 0
          ? setTimeout(
              () => controller.abort(new DOMException("请求超时", "AbortError")),
              opts.timeoutMs,
            )
          : undefined;
      if (requestInit.signal) {
        if (requestInit.signal.aborted) {
          controller.abort();
        } else {
          requestInit.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }
      }
      const innerInit = { ...requestInit, signal: controller.signal, redirect: "manual" as const };
      const impl = opts.fetchImpl ?? globalThis.fetch;
      try {
        return await impl(target.href, innerInit);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    const maxAttempts = 1 + opts.maxRetries;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        let currentUrl = url;
        let currentInit: RequestInit = { ...mergedInit };
        let res = await attemptOnce(currentUrl, currentInit);
        let redirects = 0;
        while (shouldFollowRedirect(res.status, redirect) && redirects < DEFAULT_MAX_REDIRECTS) {
          const location = res.headers.get("location");
          if (!location) {
            break;
          }
          const nextUrl = new URL(location, currentUrl.href);
          redirects += 1;
          const nextMethod =
            method === "HEAD" || res.status === 303
              ? method === "HEAD"
                ? "HEAD"
                : "GET"
              : method === "GET" || method === "HEAD"
                ? method
                : "GET";
          currentInit = {
            ...mergedInit,
            method: nextMethod,
            body: nextMethod === "GET" || nextMethod === "HEAD" ? undefined : mergedInit.body,
          };
          currentUrl = nextUrl;
          res = await attemptOnce(currentUrl, currentInit);
        }
        const durationMs = Date.now() - started;
        await auditEvent(opts, url, method, res.status, durationMs);
        return res;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const durationMs = Date.now() - started;
        await auditEvent(opts, url, method, "error", durationMs, lastError.message);
        if (attempt >= opts.maxRetries || !isRetryableHttpFailure(lastError)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
      }
    }
    throw lastError ?? new OutboundProxyError("未知请求失败");
  };

  return { fetch: fetchImpl };
}

/** 默认单例（不启用审计、不注入证书，走全局策略）。 */
export const outboundProxy = createOutboundProxy();
