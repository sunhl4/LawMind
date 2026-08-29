/** Loopback bearer token injected from Electron `getConfig` (or unset in mock/e2e). */
let loopbackApiAuthToken: string | null = null;

export function setLoopbackApiAuthToken(token: string | null | undefined): void {
  const trimmed = typeof token === "string" ? token.trim() : "";
  loopbackApiAuthToken = trimmed.length > 0 ? trimmed : null;
}

export function getLoopbackApiAuthToken(): string | null {
  return loopbackApiAuthToken;
}

export function apiAuthHeaders(): Record<string, string> {
  if (!loopbackApiAuthToken) {
    return {};
  }
  return { authorization: `Bearer ${loopbackApiAuthToken}` };
}
