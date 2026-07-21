/** Skills E11 — classic chat as default home escape hatch. */

const KEY = "lm.preferClassicChatHome";
const MIGRATION_KEY = "lm.homeMigrationBanner.dismissed";

export function readPreferClassicChatHome(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writePreferClassicChatHome(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function resolveDefaultMainView(): "home" | "workspace" {
  return readPreferClassicChatHome() ? "workspace" : "home";
}

/** One-shot banner when new Home is the default. */
export function readHomeMigrationBannerDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHomeMigrationBannerDismissed(): void {
  try {
    globalThis.localStorage?.setItem(MIGRATION_KEY, "1");
  } catch {
    /* ignore */
  }
}
