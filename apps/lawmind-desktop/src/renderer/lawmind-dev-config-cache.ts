import type { AppConfig } from "./lawmind-app-bootstrap";
import { apiAuthHeaders, setLoopbackApiAuthToken } from "./lawmind-api-auth.ts";

const API_BASE_KEY = "lawmind.dev.apiBase";
const API_TOKEN_KEY = "lawmind.dev.apiAuthToken";

/** Persist loopback API coordinates for Vite dev (shared origin with Electron renderer). */
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

async function healthReachable(apiBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/health`, {
      headers: apiAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Browser/Vite fallback when Electron preload is absent but local server is running. */
export async function loadCachedDevAppConfig(): Promise<AppConfig | null> {
  let apiBase: string | undefined;
  let apiAuthToken: string | undefined;
  try {
    apiBase = localStorage.getItem(API_BASE_KEY)?.trim() || undefined;
    apiAuthToken = localStorage.getItem(API_TOKEN_KEY)?.trim() || undefined;
  } catch {
    return null;
  }
  if (!apiBase) {
    return null;
  }
  // Set the token before the health probe so apiAuthHeaders() is populated.
  setLoopbackApiAuthToken(apiAuthToken);
  if (!(await healthReachable(apiBase))) {
    return null;
  }
  return {
    apiBase: apiBase.replace(/\/$/, ""),
    apiAuthToken,
    workspaceDir: "(browser dev — use Electron for file access)",
    projectDir: null,
    envFilePath: "",
    retrievalMode: "single",
    packaged: false,
    appVersion: "dev",
  };
}
