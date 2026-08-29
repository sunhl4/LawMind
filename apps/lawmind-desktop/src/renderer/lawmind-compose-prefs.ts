export type ComposePermissionMode = "standard" | "strict" | "readonly" | "research";

const PERMISSION_MODE_KEY = "lawmind.ui.permissionMode.v1";
/** After first-run,「开始执行」prefer strict over standard (Solo trust packaging). */
const EXECUTE_PERMISSION_KEY = "lawmind.ui.executePermissionMode.v1";

export function readComposePermissionMode(): ComposePermissionMode {
  try {
    const v = localStorage.getItem(PERMISSION_MODE_KEY);
    if (v === "strict" || v === "readonly" || v === "research") {
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

/**
 * Preferred mode when leaving「先计划」via「开始执行」.
 * Post-firstrun Solo default is `strict`; otherwise `standard`.
 */
export function readExecutePermissionMode(): "standard" | "strict" {
  try {
    const v = localStorage.getItem(EXECUTE_PERMISSION_KEY);
    if (v === "strict" || v === "standard") {
      return v;
    }
  } catch {
    /* ignore */
  }
  return "standard";
}

export function writeExecutePermissionMode(mode: "standard" | "strict"): void {
  try {
    localStorage.setItem(EXECUTE_PERMISSION_KEY, mode);
  } catch {
    /* ignore */
  }
}

/** Call when first-run wizard completes.
 *  `executable: true`（如合同审查）跳过「先计划」，直接标准权限可执行。 */
export function applyPostFirstrunPermissionDefaults(opts?: { executable?: boolean }): void {
  if (opts?.executable) {
    writeComposePermissionMode("standard");
    writeExecutePermissionMode("strict");
    return;
  }
  writeComposePermissionMode("readonly");
  writeExecutePermissionMode("strict");
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

const SHOW_TOOL_TRACE_KEY = "lawmind.ui.showToolTrace.v1";

/** F3: when true, expand tool-trace / live steps on assistant rows. */
export function readShowToolTrace(): boolean {
  try {
    return localStorage.getItem(SHOW_TOOL_TRACE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowToolTrace(on: boolean): void {
  try {
    localStorage.setItem(SHOW_TOOL_TRACE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
