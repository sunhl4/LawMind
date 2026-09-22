/**
 * Aux / popout window routing via location.hash (Electron secondary BrowserWindow).
 */

export type LawmindPopoutRoute = {
  kind: "review-preview";
  taskId: string;
};

export function parseLawmindPopoutRoute(
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
): LawmindPopoutRoute | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.trim()) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const kind = params.get("lm-popout")?.trim();
  const taskId = params.get("taskId")?.trim();
  if (kind === "review-preview" && taskId) {
    return { kind: "review-preview", taskId };
  }
  return null;
}

export function buildLawmindPopoutHash(route: LawmindPopoutRoute): string {
  const params = new URLSearchParams();
  params.set("lm-popout", route.kind);
  params.set("taskId", route.taskId);
  return params.toString();
}

export const REVIEW_PREVIEW_SYNC_CHANNEL = "lawmind-review-preview-sync";

/** Prefer live BroadcastChannel over disk poll when a live update arrived within this window. */
export const REVIEW_PREVIEW_LIVE_FRESH_MS = 12_000;

export type ReviewPreviewEditorValue = {
  title: string;
  summary: string;
  sections: Array<{ heading: string; body: string; citations?: string[] }>;
};

export type ReviewPreviewSyncMessage =
  | {
      type: "editor-value";
      taskId: string;
      value: ReviewPreviewEditorValue;
      reviewStatusLabel?: string;
      outputPath?: string | null;
      /** live = main editor (may include unsaved); saved = disk poll */
      source?: "live" | "saved";
      updatedAt?: number;
    }
  | {
      type: "sync-request";
      taskId: string;
    };

/** True when a disk/saved snapshot should not clobber a fresher live editor value. */
export function shouldApplySavedPreviewOverLive(opts: {
  lastLiveAt: number | null;
  now?: number;
  freshMs?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const freshMs = opts.freshMs ?? REVIEW_PREVIEW_LIVE_FRESH_MS;
  if (opts.lastLiveAt == null) {
    return true;
  }
  return now - opts.lastLiveAt >= freshMs;
}
