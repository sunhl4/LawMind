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
