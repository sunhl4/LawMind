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

const WORKSPACE_PANE_LABELS = Object.freeze({
  chat: "对话",
  middle: "中栏",
});

/** Cursor-like secondary window presets. Chat is narrow; the middle pane needs room. */
export const AUX_WINDOW_SIZES = Object.freeze({
  "review-preview": Object.freeze({ width: 720, height: 900, minWidth: 560, minHeight: 560 }),
  chat: Object.freeze({ width: 560, height: 900, minWidth: 420, minHeight: 560 }),
  middle: Object.freeze({ width: 960, height: 900, minWidth: 720, minHeight: 560 }),
});

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalHashFields(params, payload, keys) {
  for (const key of keys) {
    const value = trimmed(payload?.[key]);
    if (value) {
      params.set(key, value);
    }
  }
}

/**
 * Validate an aux-window request and derive everything the main process needs.
 * Pure so window sizing / dedupe keys stay unit-testable without Electron.
 *
 * @param {{
 *   kind?: string;
 *   taskId?: string;
 *   pane?: string;
 *   title?: string;
 *   sessionId?: string;
 *   assistantId?: string;
 *   matterId?: string;
 *   draftTaskId?: string;
 *   middleView?: string;
 *   relPath?: string;
 *   root?: string;
 * }} payload
 * @returns {{
 *   ok: true;
 *   key: string;
 *   kind: "review-preview" | "workspace-pane";
 *   pane?: "chat" | "middle";
 *   title: string;
 *   hash: string;
 *   width: number;
 *   height: number;
 *   minWidth: number;
 *   minHeight: number;
 * } | { ok: false; error: string }}
 */
export function resolveAuxWindowRequest(payload) {
  const kind = trimmed(payload?.kind);
  if (kind === "review-preview") {
    const taskId = trimmed(payload?.taskId);
    if (!taskId) {
      return { ok: false, error: "invalid_aux_window" };
    }
    const title = trimmed(payload?.title) || "交付预览";
    const params = new URLSearchParams();
    params.set("lm-popout", "review-preview");
    params.set("taskId", taskId);
    return {
      ok: true,
      key: `review-preview:${taskId}`,
      kind,
      title,
      hash: params.toString(),
      ...AUX_WINDOW_SIZES["review-preview"],
    };
  }
  if (kind === "workspace-pane") {
    const pane = trimmed(payload?.pane);
    if (pane !== "chat" && pane !== "middle") {
      return { ok: false, error: "invalid_aux_window" };
    }
    const relPath = trimmed(payload?.relPath);
    const fileContext = relPath
      ? `${trimmed(payload?.root) || "workspace"}:${relPath}`
      : "";
    const context =
      pane === "chat"
        ? trimmed(payload?.sessionId) || "current"
        : trimmed(payload?.draftTaskId) ||
          fileContext ||
          trimmed(payload?.matterId) ||
          "current";
    const title = trimmed(payload?.title) || WORKSPACE_PANE_LABELS[pane];
    const params = new URLSearchParams();
    params.set("lm-popout", "workspace-pane");
    params.set("pane", pane);
    params.set("title", title);
    optionalHashFields(params, payload, [
      "sessionId",
      "assistantId",
      "matterId",
      "draftTaskId",
      "middleView",
      "relPath",
      "root",
    ]);
    return {
      ok: true,
      key: `workspace-pane:${pane}:${context}`,
      kind,
      pane,
      title,
      hash: params.toString(),
      ...AUX_WINDOW_SIZES[pane],
    };
  }
  return { ok: false, error: "invalid_aux_window" };
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
