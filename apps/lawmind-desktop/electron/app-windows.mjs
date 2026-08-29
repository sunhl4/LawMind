/**
 * Pure helpers for Electron window / local-server lifetime.
 *
 * Detached DevTools is itself a BrowserWindow. Closing it can emit
 * `window-all-closed` even while the LawMind window is still up.
 * Killing the loopback API in that case leaves the main renderer failing
 * every `/api/*` call (JSON parse / fetch errors).
 */

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
