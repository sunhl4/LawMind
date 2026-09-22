import type { AppConfig } from "./lawmind-app-bootstrap";
import { setLoopbackApiAuthToken } from "./lawmind-api-auth.ts";

const API_BASE_KEY = "lawmind.dev.apiBase";
const API_TOKEN_KEY = "lawmind.dev.apiAuthToken";

/** Renderer should adopt a new loopback port/token after a 401 refresh. */
export const LOOPBACK_CONFIG_EVENT = "lawmind-loopback-config";

export type LoopbackConfigDetail = {
  apiBase: string;
  apiAuthToken?: string;
};

/** Persist loopback API coordinates for the Electron renderer (401 refresh). */
export function persistDevAppConfig(config: AppConfig): void {
  try {
    localStorage.setItem(API_BASE_KEY, config.apiBase);
    if (config.apiAuthToken?.trim()) {
      localStorage.setItem(API_TOKEN_KEY, config.apiAuthToken.trim());
    } else {
      localStorage.removeItem(API_TOKEN_KEY);
    }
  } catch {
    /* private mode / quota — ignore */
  }
}

/**
 * Pull the live Electron loopback port/token. Used after 401 so the window
 * does not keep the previous process's bearer.
 */
export function isUsableLoopbackBase(apiBase: string): boolean {
  if (!apiBase.startsWith("http://127.0.0.1:") && !apiBase.startsWith("http://localhost:")) {
    return false;
  }
  try {
    const port = Number(new URL(apiBase).port);
    return Number.isInteger(port) && port > 0 && port <= 65535;
  } catch {
    return false;
  }
}

export async function refreshLoopbackAuthFromDesktop(): Promise<LoopbackConfigDetail | null> {
  const bridge = typeof window !== "undefined" ? window.lawmindDesktop : undefined;
  if (!bridge?.getConfig) {
    return null;
  }
  const config = await bridge.getConfig();
  const apiBase = (config.apiBase ?? "").replace(/\/$/, "");
  const apiAuthToken = config.apiAuthToken?.trim() || undefined;
  if (!isUsableLoopbackBase(apiBase) || !apiAuthToken) {
    return null;
  }
  setLoopbackApiAuthToken(apiAuthToken);
  persistDevAppConfig({
    apiBase,
    apiAuthToken,
    workspaceDir: config.workspaceDir,
    projectDir: config.projectDir ?? null,
    envFilePath: config.envFilePath ?? "",
    retrievalMode: config.retrievalMode === "dual" ? "dual" : "single",
    packaged: config.packaged,
    appVersion: config.appVersion,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(LOOPBACK_CONFIG_EVENT, { detail: { apiBase, apiAuthToken } }),
    );
  }
  return { apiBase, apiAuthToken };
}
