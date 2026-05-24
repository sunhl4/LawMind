export type ComposePermissionMode = "standard" | "strict" | "readonly";

const PERMISSION_MODE_KEY = "lawmind.ui.permissionMode.v1";

export function readComposePermissionMode(): ComposePermissionMode {
  try {
    const v = localStorage.getItem(PERMISSION_MODE_KEY);
    if (v === "strict" || v === "readonly") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "standard";
}

export function writeComposePermissionMode(mode: ComposePermissionMode): void {
  try {
    localStorage.setItem(PERMISSION_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function composeStashKey(matterId: string | null | undefined): string {
  const id = matterId?.trim() || "_global";
  return `lawmind.compose.stash.${id}`;
}

export function readComposeStash(matterId: string | null | undefined): string {
  try {
    return localStorage.getItem(composeStashKey(matterId)) ?? "";
  } catch {
    return "";
  }
}

export function writeComposeStash(matterId: string | null | undefined, text: string): void {
  try {
    if (!text.trim()) {
      localStorage.removeItem(composeStashKey(matterId));
      return;
    }
    localStorage.setItem(composeStashKey(matterId), text);
  } catch {
    /* ignore */
  }
}
