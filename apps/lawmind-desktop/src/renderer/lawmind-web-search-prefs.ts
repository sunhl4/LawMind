import { readStoredBool, writeStoredBool } from "./lawmind-panel-layout.js";

/** Persisted chat compose: allow `web_search` on POST /api/chat */
export const LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY = "lawmind.ui.allowWebSearch";

/**
 * Cursor-style default: when the user has never toggled 联网, prefer on
 * if the current chat model can search the web (or Brave is configured).
 */
export function readAllowWebSearchPreference(webSearchReady: boolean): boolean {
  return readStoredBool(LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY, webSearchReady);
}

export function writeAllowWebSearchPreference(enabled: boolean): void {
  writeStoredBool(LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY, enabled);
}
