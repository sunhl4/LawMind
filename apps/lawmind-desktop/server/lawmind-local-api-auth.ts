/**
 * 本机回环 API 的鉴权边界。
 *
 * ## 两道门（顺序不可换）
 *
 * 1. **Host 必须是回环**（`validateLoopbackHttpHost`）：浏览器无法伪造 `Host`，
 *    所以这一道才是反 DNS rebinding 的关键（CORS 只挡读取、不挡执行）。
 * 2. **凭据**：`Authorization: Bearer`，比对沿用**常量时间**比较。
 *
 * ## 凭据模型（2026-09-21 起）
 *
 * 派生式（见 `electron/local-api-credentials.mjs`，那是唯一真相源）：
 *
 *   credential(clientId, epoch) = HMAC-SHA256(installationSecret, `${clientId}:${epoch}`)
 *
 * 安装密钥**跨进程持久**（keychain，降级为工作区外 0600 文件），所以同一客户端的
 * 凭据不随重启变化 —— 这正是修掉「Word 窗格重启即 401」的那一步。服务端**不存**
 * 每客户端凭据，验签时按 clientId 现算，故吊销只改名单、轮换只加一个整数。
 *
 * `LAWMIND_LOCAL_API_TOKEN`（旧式单一令牌）仍被接受，身份记为 `shared`，语义与改造前
 * 完全一致；它只是 dev/E2E 的覆盖路径，不参与派生与轮换。
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import {
  credentialForClient as deriveCredentialForClient,
  LOCAL_API_EPOCH_GRACE,
  LEGACY_SHARED_CLIENT,
  resolveClientFromCredential,
} from "../electron/local-api-credentials.mjs";

let loopbackBearerToken: string | null = null;

/** 安装密钥（持久）；为空表示未配置派生凭据，只能走旧式共享令牌。 */
let installationSecret = "";
/** 当前代；轮换即 `+1`。 */
let credentialEpoch = 1;
/** 被吊销的客户端名单。 */
let revokedClients: string[] = [];
/** 本次进程实例标识（供客户端做陈旧检测，不是秘密）。 */
let instanceId = "";

function bearerTokensEqual(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

/** Packaged desktop builds set LAWMIND_PACKAGED=1 on the local server subprocess. */
export function isLawmindPackagedRuntime(): boolean {
  return process.env.LAWMIND_PACKAGED === "1";
}

/** Generate or return the loopback API bearer token for this process. */
export function ensureLoopbackBearerToken(): string {
  if (!loopbackBearerToken) {
    loopbackBearerToken = randomBytes(32).toString("hex");
  }
  return loopbackBearerToken;
}

export function getLoopbackBearerToken(): string | null {
  return loopbackBearerToken;
}

export function initLoopbackBearerFromEnv(): void {
  const fromEnv = process.env.LAWMIND_LOCAL_API_TOKEN?.trim();
  if (fromEnv) {
    loopbackBearerToken = fromEnv;
  }
}

function parseEpoch(raw: string | undefined): number {
  const n = Number((raw ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function parseRevoked(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 载入派生凭据所需的安装密钥与代次。
 *
 * 密钥**只能**由主进程经环境变量注入：服务端自己不生成、不落盘，避免出现
 * 「两个进程各持一把钥匙」导致验签必然失败（这与审计链/邮件密钥同一姿态）。
 */
export function initLocalApiCredentialsFromEnv(): void {
  installationSecret = process.env.LAWMIND_LOCAL_API_INSTALLATION_SECRET?.trim() ?? "";
  credentialEpoch = parseEpoch(process.env.LAWMIND_LOCAL_API_EPOCH);
  revokedClients = parseRevoked(process.env.LAWMIND_LOCAL_API_REVOKED_CLIENTS);
  const fromEnv = process.env.LAWMIND_LOCAL_API_INSTANCE_ID?.trim() ?? "";
  if (fromEnv) {
    instanceId = fromEnv;
  } else if (!instanceId) {
    // 主进程没注入时兜底生成：instanceId 只回答「这是哪个服务实例」（非秘密），
    // 缺了它客户端就没法做陈旧检测。生成它不需要任何密钥，所以这里可以自给。
    instanceId = randomBytes(8).toString("hex");
  }
}

export function getLocalApiEpoch(): number {
  return credentialEpoch;
}

export function getLocalApiInstanceId(): string {
  return instanceId;
}

/** 是否具备派生凭据能力（打包版与开发版都应具备；缺少说明注入链路断了）。 */
export function hasDerivedCredentials(): boolean {
  return installationSecret.length > 0;
}

/**
 * 某个客户端在当前代的凭据（服务端下发用，如 Word 插件的 `config.js`）。
 * 缺密钥时回落到旧式共享令牌，保证「注入链路损坏」时插件仍不至于全废。
 */
export function credentialForClient(clientId: string): string {
  if (!hasDerivedCredentials()) {
    return getLoopbackBearerToken() ?? ensureLoopbackBearerToken();
  }
  return deriveCredentialForClient(installationSecret, clientId, credentialEpoch);
}

/**
 * 认证一个请求并回答「来的是谁」。返回 null 表示未通过。
 *
 * `shared` = 旧式单一令牌命中（dev/E2E 覆盖路径，语义与改造前一致）。
 */
export function resolveLoopbackClient(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) {
    return null;
  }

  // 1) 派生凭据（正常路径）
  if (hasDerivedCredentials()) {
    const clientId = resolveClientFromCredential(installationSecret, provided, credentialEpoch, {
      revoke: revokedClients,
      grace: LOCAL_API_EPOCH_GRACE,
    });
    if (clientId) {
      return clientId;
    }
  }

  // 2) 旧式共享令牌（只作为覆盖路径；改造前它就是唯一一把钥匙）
  const expected = getLoopbackBearerToken();
  if (expected && bearerTokensEqual(provided, expected)) {
    return LEGACY_SHARED_CLIENT;
  }
  return null;
}

export function isLoopbackApiAuthSkipped(): boolean {
  if (isLawmindPackagedRuntime()) {
    return false;
  }
  return process.env.LAWMIND_SKIP_API_AUTH === "1";
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * dev skip-auth 模式的 CSRF 缓释：认证全关时，变更类方法必须携带
 * `Content-Type: application/json`。跨站表单 / simple request 无法在不触发
 * CORS 预检的情况下伪造该头，而预检会被 corsHeaders 的来源白名单拦下
 * （Discord/Zoom 本地服务同型 CVE 的收口）。
 * 注意：这只是缓释——LAWMIND_SKIP_API_AUTH=1 本身是高风险 dev 开关，打包版
 * 忽略它（见 isLawmindPackagedRuntime）。本机 renderer 的 fetch 本就发
 * application/json，不受影响。
 */
export function validateLoopbackMutationContentType(req: http.IncomingMessage): boolean {
  if (!isLoopbackApiAuthSkipped()) {
    return true;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (!MUTATION_METHODS.has(method)) {
    return true;
  }
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string") {
    return false;
  }
  return contentType.toLowerCase().startsWith("application/json");
}

/**
 * Host must be loopback when present. Missing Host is allowed only outside
 * packaged builds (HTTP/1.0, Vitest mocks). DNS rebind sends Host: evil.com.
 */
export function hostnameFromHostHeader(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) {
    return null;
  }
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 1) {
      return null;
    }
    return h.slice(1, end);
  }
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) {
    return h.slice(0, colon);
  }
  return h;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function isAllowedLoopbackHttpHost(host: string | undefined): boolean {
  if (!host?.trim()) {
    return !isLawmindPackagedRuntime();
  }
  const hostname = hostnameFromHostHeader(host);
  return hostname !== null && LOOPBACK_HOSTNAMES.has(hostname);
}

export function validateLoopbackHttpHost(req: http.IncomingMessage): boolean {
  const header = req.headers.host;
  const host = Array.isArray(header) ? header[0] : header;
  return isAllowedLoopbackHttpHost(typeof host === "string" ? host : undefined);
}

/** 保留的布尔签名（既有调用点与测试用）；语义等价于「能否认出这个客户端」。 */
export function validateLoopbackApiAuth(req: http.IncomingMessage): boolean {
  if (isLoopbackApiAuthSkipped()) {
    return true;
  }
  return resolveLoopbackClient(req) !== null;
}
