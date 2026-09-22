/**
 * Focus the left-rail conversation search (Cursor-style jump to other chats).
 */

export const LAWMIND_FOCUS_CHAT_SEARCH_EVENT = "lawmind:focus-chat-search";

export function requestFocusChatSearch(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAWMIND_FOCUS_CHAT_SEARCH_EVENT));
}

export function isChatSearchFocusHotkey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) {
    return false;
  }
  return e.key.toLowerCase() === "o";
}
