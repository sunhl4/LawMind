/**
 * Pure helpers for Electron window / local-server lifetime.
 *
 * Detached DevTools is itself a BrowserWindow. Closing it can emit
 * `window-all-closed` even while the LawMind window is still up.
 * Killing the loopback API in that case leaves the main renderer failing
 * every `/api/*` call (JSON parse / fetch errors).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string | undefined | null} url
 */
export function isDevToolsWindowUrl(url) {
  return typeof url === "string" && url.startsWith("devtools://");
}

/**
 * @param {string | undefined | null} url
 */
export function isAuxPopoutWindowUrl(url) {
  return typeof url === "string" && url.includes("lm-popout=");
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

/**
 * Main-window `will-navigate` allowlist. A remote page navigated into the main
 * window would inherit its preload (loopback token + fs bridge), so only the
 * expected origins may navigate:
 *   - packaged renderer: file:// under the bundled dist/ directory
 *   - dev: the Vite dev server port on loopback (localhost / 127.0.0.1)
 * Everything else is prevented by the caller.
 *
 * @param {string | undefined | null} url
 * @param {{ devServerUrl: string; distIndexPath: string }} opts
 */
export function isAllowedMainWindowNavigationUrl(url, opts) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "file:") {
    const distDir = path.dirname(opts.distIndexPath);
    const target = path.normalize(fileURLToPath(url));
    return target === path.normalize(opts.distIndexPath) || target.startsWith(distDir + path.sep);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return false;
  }
  let dev;
  try {
    dev = new URL(opts.devServerUrl);
  } catch {
    return false;
  }
  return u.port === dev.port && isLoopbackHostname(u.hostname) && isLoopbackHostname(dev.hostname);
}

/**
 * @param {{
 *   mainAlive?: boolean;
 *   auxAliveCount?: number;
 *   remainingAppWindowCount?: number;
 * }} state
 */
export function shouldKeepLocalServerAlive(state) {
  if (state.mainAlive) {
    return true;
  }
  if ((state.auxAliveCount ?? 0) > 0) {
    return true;
  }
  if ((state.remainingAppWindowCount ?? 0) > 0) {
    return true;
  }
  return false;
}
