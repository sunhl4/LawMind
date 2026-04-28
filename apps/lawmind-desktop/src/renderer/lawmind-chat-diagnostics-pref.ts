/** localStorage key: when set, POST /api/chat includes `includeTurnDiagnostics: true` (Solo edition). */
export const LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY = "lawmind.includeTurnDiagnostics";

function getStorage(): Storage | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      const s = globalThis.localStorage;
      if (
        s &&
        typeof s.getItem === "function" &&
        typeof s.setItem === "function" &&
        typeof s.removeItem === "function"
      ) {
        return s;
      }
    }
  } catch {
    /* restricted context */
  }
  return null;
}

export function readIncludeTurnDiagnostics(): boolean {
  const s = getStorage();
  if (!s) {
    return false;
  }
  return s.getItem(LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY) === "1";
}

export function writeIncludeTurnDiagnostics(enabled: boolean): void {
  const s = getStorage();
  if (!s) {
    return;
  }
  if (enabled) {
    s.setItem(LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY, "1");
  } else {
    s.removeItem(LAWMIND_INCLUDE_TURN_DIAGNOSTICS_KEY);
  }
}
