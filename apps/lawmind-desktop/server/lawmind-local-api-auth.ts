import { randomBytes, timingSafeEqual } from "node:crypto";
import type http from "node:http";

let loopbackBearerToken: string | null = null;

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

export function validateLoopbackApiAuth(req: http.IncomingMessage): boolean {
  if (isLoopbackApiAuthSkipped()) {
    return true;
  }
  const expected = getLoopbackBearerToken() ?? ensureLoopbackBearerToken();
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length).trim();
  return bearerTokensEqual(token, expected);
}
