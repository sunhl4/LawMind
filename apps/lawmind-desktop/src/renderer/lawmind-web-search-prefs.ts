import { readStoredBool, writeStoredBool } from "./lawmind-panel-layout.js";

/** Persisted chat compose: allow Brave `web_search` on POST /api/chat */
export const LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY = "lawmind.ui.allowWebSearch";

/**
 * Cursor-style default: when the user has never toggled retrieval mode, prefer
 * web search if a Brave API key is configured on the server.
 */
export function readAllowWebSearchPreference(webSearchApiKeyConfigured: boolean): boolean {
  return readStoredBool(LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY, webSearchApiKeyConfigured);
}

export function writeAllowWebSearchPreference(enabled: boolean): void {
  writeStoredBool(LAWMIND_ALLOW_WEB_SEARCH_STORAGE_KEY, enabled);
}
