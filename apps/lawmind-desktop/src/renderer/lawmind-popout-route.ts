/**
 * Aux / popout window routing via location.hash (Electron secondary BrowserWindow).
 */

/** 主区可拆成独立窗口的两块：右侧对话 / 左侧（中栏）工作区。 */
export type LawmindWorkspacePane = "chat" | "middle";

export type LawmindWorkspacePaneRoute = {
  kind: "workspace-pane";
  pane: LawmindWorkspacePane;
  /** 窗口标题；缺省按 pane 生成。 */
  title?: string;
  /** 对话窗：打开哪一场对话（缺省沿用本机上次的会话）。 */
  sessionId?: string;
  assistantId?: string;
  /** 中栏窗：打开哪一案 / 哪份草稿 / 哪份文件（三者取其一）。 */
  matterId?: string;
  draftTaskId?: string;
  middleView?: "matter" | "draft" | "file";
  relPath?: string;
  root?: string;
};

export type LawmindPopoutRoute =
  | { kind: "review-preview"; taskId: string }
  | LawmindWorkspacePaneRoute;

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)?.trim();
  return value || undefined;
}

export function parseLawmindPopoutRoute(
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
): LawmindPopoutRoute | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.trim()) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const kind = params.get("lm-popout")?.trim();
  if (kind === "review-preview") {
    const taskId = params.get("taskId")?.trim();
    return taskId ? { kind: "review-preview", taskId } : null;
  }
  if (kind === "workspace-pane") {
    const pane = params.get("pane")?.trim();
    if (pane !== "chat" && pane !== "middle") {
      return null;
    }
    return {
      kind: "workspace-pane",
      pane,
      title: optionalParam(params, "title"),
      sessionId: optionalParam(params, "sessionId"),
      assistantId: optionalParam(params, "assistantId"),
      matterId: optionalParam(params, "matterId"),
      draftTaskId: optionalParam(params, "draftTaskId"),
      middleView: (() => {
        const value = optionalParam(params, "middleView");
        return value === "matter" || value === "draft" || value === "file" ? value : undefined;
      })(),
      relPath: optionalParam(params, "relPath"),
      root: optionalParam(params, "root"),
    };
  }
  return null;
}

export function buildLawmindPopoutHash(route: LawmindPopoutRoute): string {
  const params = new URLSearchParams();
  params.set("lm-popout", route.kind);
  if (route.kind === "review-preview") {
    params.set("taskId", route.taskId);
  } else {
    params.set("pane", route.pane);
    for (const key of [
      "title",
      "sessionId",
      "assistantId",
      "matterId",
      "draftTaskId",
      "middleView",
      "relPath",
      "root",
    ] as const) {
      const value = route[key]?.trim();
      if (value) {
        params.set(key, value);
      }
    }
  }
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
