/**
 * Open .docx in the chat middle column as a text preview. Dialogue revisions
 * paint onto the file's paragraphs. Accepted hunks can be exported beside the
 * original; this page is not the final Word.
 */

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  replaceChangeAfter,
  revisionPieces,
} from "../../../../../src/lawmind/drafts/word-surface-pieces.ts";
import type {
  WordLineSpacing,
  WordMeasure,
  WordPageBox,
  WordSurfaceBlock,
  WordSurfaceHunkView,
  WordSurfaceParagraph,
  WordSurfaceSegment,
  WordSurfaceSnapshot,
} from "../../../../../src/lawmind/drafts/word-surface.ts";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";
import { openDeliverableInWps } from "../canvas/host-actions";
import { openBoundBaselineIfDifferent } from "../lawmind-open-contract-revision";
import { usePaneResizePx } from "../use-pane-resize";
import {
  applyDeletionMark,
  gateWordSurfaceBeforeInput,
  isWordSurfaceKeyTarget,
  rememberMove,
  removeDeletionMark,
  suppressCompositionEcho,
  wordSurfaceUndoRedo,
  wrapCommittedInsertion,
} from "./word-surface-edit";
import {
  matchSyncedLawyerHunks,
  popSyncedLawyerUndo,
  pushSyncedLawyerUndo,
  type SyncedLawyerUndo,
} from "./word-surface-synced-undo";

type SurfaceComment = {
  commentId: string;
  taskId: string;
  anchorText: string;
  body: string;
  author: string;
  createdAt: string;
};

const POLL_MS = 4_000;
/** Pause after typing / 删除线 before pushing the rail revision. */
const SYNC_DEBOUNCE_MS = 500;

type MarkupMode = "all" | "simple" | "none" | "original";

type LiveEdit = { key: string; before: string; after: string };

type RootKey = "workspace" | "project";

export type LawmindWordRevisionSurfaceProps = {
  apiBase: string;
  projectDir?: string | null;
  root: RootKey;
  relPath: string;
  fileName: string;
  busy?: boolean;
  onOpenWithSystem: () => void;
  onRevealSource: () => void;
};

type SurfaceResponse =
  | ({ ok: true; unchanged: true; codeStamp?: string } & Partial<WordSurfaceSnapshot>)
  | ({ ok: true; unchanged?: false; codeStamp?: string } & WordSurfaceSnapshot);

function surfaceQuery(
  root: RootKey,
  relPath: string,
  projectDir: string | null | undefined,
  seen: { fileMtimeMs: number; proposalAt: string; codeStamp: string } | null,
): string {
  const q = new URLSearchParams({ root, path: relPath });
  if (projectDir?.trim()) {
    q.set("projectDir", projectDir.trim());
  }
  if (seen) {
    q.set("fileMtime", String(seen.fileMtimeMs));
    q.set("proposalAt", seen.proposalAt);
    if (seen.codeStamp) {
      q.set("codeStamp", seen.codeStamp);
    }
  }
  return `/api/word-surface?${q.toString()}`;
}

function snapshotKey(snap: WordSurfaceSnapshot): string {
  return JSON.stringify({
    taskId: snap.taskId,
    updatedAt: snap.updatedAt,
    blocks: snap.blocks,
    page: snap.page,
    paragraphs: snap.paragraphs,
    hunks: snap.hunks.map((hunk) => [hunk.hunkId, hunk.status, hunk.color, hunk.before, hunk.after, hunk.placed]),
  });
}

function revisionColor(hunks: WordSurfaceHunkView[], hunkId: string): number {
  return hunks.find((hunk) => hunk.hunkId === hunkId)?.color ?? 0;
}

function liveAfter(drafts: Record<string, string>, hunkId: string, after: string): string {
  return drafts[hunkId] ?? after;
}

function dropSettledDrafts(
  drafts: Record<string, string>,
  hunks: WordSurfaceHunkView[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const hunk of hunks) {
    const typed = drafts[hunk.hunkId];
    if (typed !== undefined && typed !== hunk.after) {
      next[hunk.hunkId] = typed;
    }
  }
  return next;
}

function markStyle(segment: WordSurfaceSegment, revision: boolean): CSSProperties {
  return {
    fontWeight: segment.bold ? 700 : undefined,
    fontStyle: segment.italic ? "italic" : undefined,
    textDecoration: !revision && segment.underline ? "underline" : undefined,
    fontSize: segment.fontSizePx ? `${segment.fontSizePx}px` : undefined,
    fontFamily: segment.fontFamily,
    color: revision ? undefined : segment.fontColor,
  };
}

function measureCss(measure: WordMeasure | undefined, line: WordLineSpacing | undefined): string | undefined {
  if (!measure) {
    return undefined;
  }
  if (measure.unit === "px") {
    return `${measure.value}px`;
  }
  if (measure.unit === "em") {
    return `${measure.value}em`;
  }
  if (line?.rule === "exact" || line?.rule === "atLeast") {
    return `${Math.round(measure.value * line.px * 10) / 10}px`;
  }
  const multiple = line?.rule === "auto" ? line.multiple : 1;
  return `${Math.round(measure.value * multiple * 1000) / 1000}em`;
}

function lineCss(line: WordLineSpacing | undefined): string | undefined {
  if (!line) {
    return undefined;
  }
  if (line.rule === "auto") {
    return String(line.multiple);
  }
  return `${line.px}px`;
}

function paragraphStyle(paragraph: WordSurfaceParagraph): CSSProperties {
  const align = paragraph.align === "both" ? "justify" : paragraph.align;
  return {
    textAlign: align,
    paddingLeft: measureCss(paragraph.indent, paragraph.line),
    textIndent: measureCss(paragraph.firstIndent, paragraph.line),
    marginTop: measureCss(paragraph.spaceBefore, paragraph.line),
    marginBottom: measureCss(paragraph.spaceAfter, paragraph.line),
    lineHeight: lineCss(paragraph.line),
    fontFamily: paragraph.fontFamily,
  };
}

function pageStyle(page: WordPageBox | undefined): CSSProperties {
  const box = page ?? {
    widthPx: 793.7,
    marginTopPx: 96,
    marginRightPx: 96,
    marginBottomPx: 96,
    marginLeftPx: 96,
    fontFamily: 'SimSun, "NSimSun", "Songti SC", "STSong", "Noto Serif SC", serif',
    fontSizePx: 16,
  };
  return {
    width: box.widthPx,
    paddingTop: box.marginTopPx,
    paddingRight: box.marginRightPx,
    paddingBottom: box.marginBottomPx,
    paddingLeft: box.marginLeftPx,
    fontFamily: box.fontFamily,
    fontSize: box.fontSizePx ? `${box.fontSizePx}px` : undefined,
  };
}

export function LawmindWordRevisionSurface(props: LawmindWordRevisionSurfaceProps): ReactNode {
  const { apiBase, projectDir, root, relPath, fileName, busy = false, onRevealSource } = props;
  const [snapshot, setSnapshot] = useState<WordSurfaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, "accepted" | "rejected">>({});
  const [liveEdits, setLiveEdits] = useState<LiveEdit[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const [markup, setMarkup] = useState<MarkupMode>("all");
  const [pageEpoch, setPageEpoch] = useState(0);
  const [comments, setComments] = useState<SurfaceComment[]>([]);
  const keyRef = useRef("");
  const reboundRef = useRef("");
  const seenRef = useRef<{ fileMtimeMs: number; proposalAt: string; codeStamp: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editingPlainRef = useRef(false);
  const dirtyPlainRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const syncingRef = useRef(false);
  const pagePaintRef = useRef<SurfacePaint | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const paintedSaveRef = useRef(false);
  const syncedUndoRef = useRef<SyncedLawyerUndo[]>([]);
  const liveEditsBeforeSyncRef = useRef<LiveEdit[]>([]);
  /** While true, snapshot updates must not rebuild the page DOM. */
  const holdPagePaint = () =>
    dirtyPlainRef.current || editingPlainRef.current || composingRef.current || syncingRef.current;
  const { width: railWidth, onResizePointerDown: onRailResize } = usePaneResizePx({
    storageKey: "lawmind.ui.wordSurfaceRailWidth",
    defaultWidth: 220,
    min: 180,
    max: 480,
    edge: "trailing",
  });

  const reloadComments = useCallback(
    async (taskId: string | null | undefined) => {
      if (!apiBase.trim() || !taskId) {
        setComments([]);
        return;
      }
      try {
        const body = await apiGetJson<{ ok: true; comments: SurfaceComment[] }>(
          apiBase,
          `/api/word-surface/comments?taskId=${encodeURIComponent(taskId)}`,
        );
        setComments(body.comments ?? []);
      } catch {
        /* keep prior comments */
      }
    },
    [apiBase],
  );

  const reload = useCallback(async (opts?: { fresh?: boolean }): Promise<WordSurfaceSnapshot | null> => {
    if (document.activeElement?.closest(".lm-word-rev-edit")) {
      return snapshotRef.current;
    }
    if (!opts?.fresh && holdPagePaint()) {
      return snapshotRef.current;
    }
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份 Word。");
      return null;
    }
    try {
      const body = await apiGetJson<SurfaceResponse>(
        apiBase,
        surfaceQuery(root, relPath, projectDir, seenRef.current),
      );
      if (body.unchanged) {
        if (seenRef.current && body.codeStamp) {
          seenRef.current = { ...seenRef.current, codeStamp: body.codeStamp };
        }
        setLoadError(null);
        return snapshotRef.current;
      }
      if ((body.hunks?.length ?? 0) === 0 && !body.taskId && reboundRef.current !== relPath) {
        reboundRef.current = relPath;
        void openBoundBaselineIfDifferent({ apiBase, relPath });
      }
      const nextKey = snapshotKey(body);
      if (nextKey !== keyRef.current) {
        keyRef.current = nextKey;
        setSnapshot(body);
        snapshotRef.current = body;
        seenRef.current = {
          fileMtimeMs: body.fileMtimeMs ?? 0,
          proposalAt: body.proposalUpdatedAt ?? "",
          codeStamp: body.codeStamp ?? "",
        };
        setDrafts((current) => dropSettledDrafts(current, body.hunks));
        void reloadComments(body.taskId);
      } else {
        seenRef.current = {
          fileMtimeMs: body.fileMtimeMs ?? seenRef.current?.fileMtimeMs ?? 0,
          proposalAt: body.proposalUpdatedAt ?? "",
          codeStamp: body.codeStamp ?? seenRef.current?.codeStamp ?? "",
        };
      }
      setLoadError(null);
      return body;
    } catch (err) {
      if (!keyRef.current) {
        setLoadError(errorMessage(err, "读不到这份 Word。"));
      }
      return snapshotRef.current;
    }
  }, [apiBase, projectDir, relPath, reloadComments, root]);

  useEffect(() => {
    keyRef.current = "";
    seenRef.current = null;
    dirtyPlainRef.current = false;
    editingPlainRef.current = false;
    syncedUndoRef.current = [];
    setSnapshot(null);
    setExportNote(null);
    setExportPath(null);
    setDrafts({});
    setLiveEdits([]);
    setComments([]);
    setSelectedId(null);
    void reload();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void reload();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const replacementText = (hunkId: string, after: string) => drafts[hunkId] ?? after;

  const syncDocument = useCallback(async (opts?: { force?: boolean }) => {
    const page = rootRef.current?.querySelector(".lm-word-surface-page");
    if (!apiBase.trim() || !page || actionBusy) {
      return;
    }
    const paragraphs = [...page.querySelectorAll<HTMLElement>("[data-baseline]")].map((node) => ({
      baseline: node.dataset.baseline ?? "",
      current: visibleResultText(node),
    }));
    const moves = [
      ...new Set(
        [...page.querySelectorAll<HTMLElement>("[data-move]")]
          .map((node) => (node.textContent ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const changed = paragraphs.some((row) => row.baseline !== row.current);
    const insertionEdits = changed ? [] : paintedInsertionEdits(page, snapshotRef.current?.hunks ?? [], draftsRef.current);
    if (!opts?.force && !changed && insertionEdits.length === 0) {
      if (!editingPlainRef.current && !composingRef.current) {
        dirtyPlainRef.current = false;
      }
      return;
    }
    liveEditsBeforeSyncRef.current = readLiveEdits(page);
    syncingRef.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      if (!changed && insertionEdits.length > 0) {
        const taskId = snapshotRef.current?.taskId;
        if (taskId) {
          for (const edit of insertionEdits) {
            await apiSendJson(apiBase, `/api/word-surface/hunks/${encodeURIComponent(edit.hunkId)}/revise`, "POST", {
              taskId,
              after: edit.after,
            });
          }
          setDrafts((current) => {
            const next = { ...current };
            for (const edit of insertionEdits) {
              next[edit.hunkId] = edit.after;
            }
            return next;
          });
        }
      } else {
        await apiSendJson(apiBase, "/api/word-surface/sync", "POST", {
          root,
          path: relPath,
          paragraphs,
          ...(moves.length > 0 ? { moves } : {}),
          ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
        });
      }
      keyRef.current = "";
      seenRef.current = null;
      const stillTyping = Boolean(
        document.activeElement?.closest(".lm-word-surface-plain, .lm-word-rev-edit"),
      );
      // Keep dirty while the caret is still in the page so a reload cannot
      // rebuild the editor and wipe the characters the lawyer just typed.
      if (!stillTyping) {
        editingPlainRef.current = false;
      } else {
        dirtyPlainRef.current = true;
        editingPlainRef.current = true;
      }
      const nextSnap = await reload({ fresh: true });
      paintedSaveRef.current = true;
      const pageNow = rootRef.current?.querySelector(".lm-word-surface-page");
      if (pageNow) {
        setLiveEdits(readLiveEdits(pageNow));
      }
      const taskId = nextSnap?.taskId ?? snapshotRef.current?.taskId;
      if (taskId) {
        const matched = matchSyncedLawyerHunks(
          nextSnap?.hunks ?? snapshotRef.current?.hunks ?? [],
          liveEditsBeforeSyncRef.current,
        );
        for (const row of matched) {
          syncedUndoRef.current = pushSyncedLawyerUndo(syncedUndoRef.current, {
            taskId,
            hunkId: row.hunkId,
            before: row.before,
            after: row.after,
          });
        }
      }
      if (!stillTyping && !composingRef.current) {
        dirtyPlainRef.current = false;
      }
    } catch (err) {
      setActionError(errorMessage(err, "没能按原文更新修订。"));
    } finally {
      syncingRef.current = false;
      setActionBusy(false);
    }
  }, [actionBusy, apiBase, projectDir, relPath, reload, root]);

  const recordFormat = useCallback(
    async (format: "加粗" | "倾斜" | "下划线", text: string) => {
      if (!apiBase.trim() || !text.trim()) {
        return;
      }
      try {
        await apiSendJson(apiBase, "/api/word-surface/hunks", "POST", {
          root,
          path: relPath,
          before: text,
          after: text,
          format,
          ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
        });
        keyRef.current = "";
        seenRef.current = null;
        await reload({ fresh: true });
      } catch (err) {
        setActionError(errorMessage(err, "没能记下格式修订。"));
      }
    },
    [apiBase, projectDir, relPath, reload, root],
  );

  const markPlainDirty = useCallback(() => {
    editingPlainRef.current = true;
    dirtyPlainRef.current = true;
  }, []);

  const scheduleSync = useCallback(() => {
    markPlainDirty();
    if (!composingRef.current) {
      const page = rootRef.current?.querySelector(".lm-word-surface-page");
      if (page) {
        setLiveEdits(readLiveEdits(page));
      }
    }
    if (composingRef.current) {
      return;
    }
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      if (composingRef.current) {
        return;
      }
      void syncDocument();
    }, SYNC_DEBOUNCE_MS);
  }, [markPlainDirty, syncDocument]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  const syncDocumentRef = useRef(syncDocument);
  syncDocumentRef.current = syncDocument;

  // Leaving the page commits and then repaints. Moving to another line on the
  // same page must not rebuild the editor — that drops the caret and Control+Z.
  const onPlainFocus = useCallback((active: boolean) => {
    editingPlainRef.current = active;
    if (active || composingRef.current) {
      return;
    }
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      void syncDocumentRef.current();
      return;
    }
    if (syncingRef.current || !dirtyPlainRef.current) {
      return;
    }
    if (!paintedSaveRef.current) {
      void syncDocumentRef.current();
      return;
    }
    const page = rootRef.current?.querySelector(".lm-word-surface-page");
    const pending = page ? readLiveEdits(page) : [];
    const hunks = snapshotRef.current?.hunks ?? [];
    const uncovered = pending.some(
      (edit) => !hunks.some((hunk) => hunk.before === edit.before && hunk.after === edit.after),
    );
    if (uncovered) {
      setLiveEdits(pending);
      return;
    }
    // Proposal covers every live edit — safe to rebuild the page.
    paintedSaveRef.current = false;
    dirtyPlainRef.current = false;
    setLiveEdits([]);
    setPageEpoch((value) => value + 1);
  }, []);

  const focusHunk = useCallback((hunkId: string, slot: "page" | "rail") => {
    setSelectedId(hunkId);
    setOpenIds((current) => ({ ...current, [hunkId]: true }));
    const node = rootRef.current?.querySelector(
      `[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="${slot}"]`,
    );
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const showAllMarkup = useCallback((hunkId?: string) => {
    setMarkup("all");
    if (hunkId) {
      setSelectedId(hunkId);
      setOpenIds((current) => ({ ...current, [hunkId]: true }));
      window.requestAnimationFrame(() => {
        const page = rootRef.current?.querySelector(
          `[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="page"]`,
        );
        const rail = rootRef.current?.querySelector(
          `[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="rail"]`,
        );
        page?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        rail?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, []);

  const undoSyncedLawyerHunk = useCallback(async () => {
    const { stack, entry } = popSyncedLawyerUndo(syncedUndoRef.current);
    syncedUndoRef.current = stack;
    if (!entry || !apiBase.trim()) {
      return false;
    }
    try {
      await apiSendJson(
        apiBase,
        `/api/word-surface/hunks/${encodeURIComponent(entry.hunkId)}/undo`,
        "POST",
        { taskId: entry.taskId },
      );
      keyRef.current = "";
      seenRef.current = null;
      dirtyPlainRef.current = false;
      editingPlainRef.current = false;
      setLiveEdits([]);
      await reload({ fresh: true });
      setPageEpoch((value) => value + 1);
      return true;
    } catch (err) {
      setActionError(errorMessage(err, "没能撤销这条修订。"));
      syncedUndoRef.current = pushSyncedLawyerUndo(syncedUndoRef.current, entry);
      return false;
    }
  }, [apiBase, reload]);

  const stepRevision = (direction: -1 | 1) => {
    const ids = snapshot?.hunks.map((hunk) => hunk.hunkId) ?? [];
    if (ids.length === 0) {
      return;
    }
    const current = selectedId ? ids.indexOf(selectedId) : -1;
    const next = ids[(current + direction + ids.length) % ids.length];
    if (next) {
      focusHunk(next, "page");
    }
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const desk = root?.querySelector<HTMLElement>(".lm-word-surface-desk");
    const margin = root?.querySelector<HTMLElement>(".lm-word-surface-rail-margin");
    if (!root || !desk || !margin || markup !== "all") {
      return undefined;
    }
    let spacer = margin.querySelector<HTMLElement>(".lm-word-rev-spacer");
    if (!spacer) {
      spacer = document.createElement("div");
      spacer.className = "lm-word-rev-spacer";
      margin.appendChild(spacer);
    }
    const place = () => {
      const cards = [...margin.querySelectorAll<HTMLElement>("[data-word-slot='rail']")];
      const marginTop = margin.getBoundingClientRect().top;
      const tops = cards.map((card) => {
        const id = card.dataset.wordHunk ?? "";
        const page = id
          ? desk.querySelector<HTMLElement>(`[data-word-hunk="${CSS.escape(id)}"][data-word-slot="page"]`)
          : null;
        const wanted = page
          ? page.getBoundingClientRect().top - marginTop + margin.scrollTop
          : Number.POSITIVE_INFINITY;
        return { card, wanted };
      });
      tops.sort((a, b) => a.wanted - b.wanted);
      let stack = 0;
      for (const row of tops) {
        const top = Number.isFinite(row.wanted) ? Math.max(row.wanted, stack) : stack;
        row.card.style.top = `${top}px`;
        stack = top + row.card.offsetHeight + 8;
      }
      spacer.style.height = `${Math.max(desk.scrollHeight, stack)}px`;
    };
    const syncFromDesk = () => {
      if (margin.scrollTop !== desk.scrollTop) {
        margin.scrollTop = desk.scrollTop;
      }
      place();
    };
    const syncFromMargin = () => {
      if (desk.scrollTop !== margin.scrollTop) {
        desk.scrollTop = margin.scrollTop;
      }
    };
    place();
    desk.addEventListener("scroll", syncFromDesk);
    margin.addEventListener("scroll", syncFromMargin);
    window.addEventListener("resize", place);
    return () => {
      desk.removeEventListener("scroll", syncFromDesk);
      margin.removeEventListener("scroll", syncFromMargin);
      window.removeEventListener("resize", place);
    };
  }, [markup, snapshot, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const rootNode = rootRef.current;
      if (!rootNode || !isWordSurfaceKeyTarget(rootNode, event)) {
        return;
      }
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && key === "x") {
        const range = editorTextRange();
        if (!range) {
          return;
        }
        event.preventDefault();
        const text = range.toString();
        rememberMove(text);
        void navigator.clipboard?.writeText(text).catch(() => undefined);
        applyDeletionMark(range);
        scheduleSync();
        return;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (key === "b" || key === "i" || key === "u")
      ) {
        const range = editorTextRange();
        const selected = range?.toString() ?? "";
        if (!selected) {
          return;
        }
        event.preventDefault();
        const format = key === "b" ? "加粗" : key === "i" ? "倾斜" : "下划线";
        const command = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
        if (typeof document.execCommand === "function") {
          document.execCommand(command);
        }
        void recordFormat(format, selected);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.altKey) {
        event.preventDefault();
        if (event.shiftKey) {
          wordSurfaceUndoRedo(
            window.getSelection()?.anchorNode ?? (event.target instanceof Node ? event.target : null),
            true,
          );
          scheduleSync();
          return;
        }
        const page = rootRef.current?.querySelector(".lm-word-surface-page");
        const beforeHtml = page?.innerHTML ?? "";
        wordSurfaceUndoRedo(
          window.getSelection()?.anchorNode ?? (event.target instanceof Node ? event.target : null),
          false,
        );
        const afterHtml = rootRef.current?.querySelector(".lm-word-surface-page")?.innerHTML ?? "";
        if (beforeHtml !== afterHtml) {
          scheduleSync();
          return;
        }
        void undoSyncedLawyerHunk();
        return;
      }
      if (key !== "s" || event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) {
        return;
      }
      event.preventDefault();
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      void syncDocument({ force: true });
    };
    const onBeforeInput = (event: Event) => {
      if (!(event instanceof InputEvent)) {
        return;
      }
      const rootNode = rootRef.current;
      if (!rootNode || !(event.target instanceof Node) || !rootNode.contains(event.target)) {
        return;
      }
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }
      if (!gateWordSurfaceBeforeInput(event)) {
        return;
      }
      setActionError(null);
      scheduleSync();
    };
    const onCompositionStart = (event: Event) => {
      const rootNode = rootRef.current;
      if (!rootNode || !(event.target instanceof Node) || !rootNode.contains(event.target)) {
        return;
      }
      composingRef.current = true;
      editingPlainRef.current = true;
      dirtyPlainRef.current = true;
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
    const onCompositionEnd = (event: Event) => {
      const rootNode = rootRef.current;
      if (!rootNode || !(event.target instanceof Node) || !rootNode.contains(event.target)) {
        return;
      }
      composingRef.current = false;
      const committed = event instanceof CompositionEvent ? event.data : "";
      if (committed) {
        suppressCompositionEcho(committed);
        wrapCommittedInsertion(committed);
      }
      setActionError(null);
      scheduleSync();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeinput", onBeforeInput, true);
    window.addEventListener("compositionstart", onCompositionStart, true);
    window.addEventListener("compositionend", onCompositionEnd, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeinput", onBeforeInput, true);
      window.removeEventListener("compositionstart", onCompositionStart, true);
      window.removeEventListener("compositionend", onCompositionEnd, true);
    };
  }, [recordFormat, scheduleSync, syncDocument, undoSyncedLawyerHunk]);

  const showSelectionMenu = (clientX?: number, clientY?: number) => {
    const range = editorTextRange();
    if (!range) {
      setSelectionMenu(null);
      return;
    }
    const rect =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : { left: 0, bottom: 0 };
    const anchor = range.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor.parentElement;
    setSelectionMenu({
      x: clientX ?? rect.left,
      y: clientY ?? rect.bottom + 6,
      inDeletion: Boolean(el?.closest("del")),
      fileActions: false,
    });
  };

  useEffect(() => {
    if (!selectionMenu) {
      return undefined;
    }
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".lm-word-selection-menu")) {
        return;
      }
      setSelectionMenu(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [selectionMenu]);

  const strikeSelection = () => {
    const range = editorTextRange();
    if (!range) {
      return;
    }
    if (!applyDeletionMark(range)) {
      setActionError("没能加上删除线，请重新选中正文再试。");
      return;
    }
    setActionError(null);
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    scheduleSync();
  };

  const unstrikeSelection = () => {
    const range = editorTextRange();
    const anchor = range?.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const del = el?.closest("del");
    if (!del) {
      return;
    }
    if (!removeDeletionMark(del)) {
      setActionError("没能取消删除线，请重新选中再试。");
      return;
    }
    setActionError(null);
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    scheduleSync();
  };

  const decide = async (hunkId: string, decision: "accept" | "reject") => {
    const taskId = snapshot?.taskId;
    const hunk = snapshot?.hunks.find((row) => row.hunkId === hunkId);
    if (!taskId || !hunk || actionBusy) {
      return;
    }
    const target = decision === "accept" ? "accepted" : "rejected";
    setDecisions((current) => ({ ...current, [hunkId]: target }));
    setOpenIds((current) => ({ ...current, [hunkId]: false }));
    setActionBusy(true);
    setActionError(null);
    try {
      const after = replacementText(hunkId, hunk.after);
      if (after !== hunk.after) {
        await apiSendJson(
          apiBase,
          `/api/word-surface/hunks/${encodeURIComponent(hunkId)}/revise`,
          "POST",
          { taskId, after },
        );
      }
      if (hunk.status !== target) {
        await apiSendJson(
          apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}/redline/hunks/${encodeURIComponent(hunkId)}/resolve`,
          "POST",
          { decision },
        );
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[hunkId];
        return next;
      });
      keyRef.current = "";
      seenRef.current = null;
      await reload({ fresh: true });
    } catch (err) {
      setDecisions((current) => {
        const next = { ...current };
        delete next[hunkId];
        return next;
      });
      setOpenIds((current) => ({ ...current, [hunkId]: true }));
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const decideAll = async (decision: "accept" | "reject") => {
    const taskId = snapshot?.taskId;
    const pendingHunks = snapshot?.hunks.filter((hunk) => hunk.status === "pending") ?? [];
    if (!taskId || pendingHunks.length === 0 || actionBusy) {
      return;
    }
    const target = decision === "accept" ? "accepted" : "rejected";
    setDecisions((current) => {
      const next = { ...current };
      for (const hunk of pendingHunks) {
        next[hunk.hunkId] = target;
      }
      return next;
    });
    setOpenIds((current) => {
      const next = { ...current };
      for (const hunk of pendingHunks) {
        next[hunk.hunkId] = false;
      }
      return next;
    });
    setActionBusy(true);
    setActionError(null);
    try {
      for (const hunk of pendingHunks) {
        await apiSendJson(
          apiBase,
          `/api/drafts/${encodeURIComponent(taskId)}/redline/hunks/${encodeURIComponent(hunk.hunkId)}/resolve`,
          "POST",
          { decision },
        );
      }
      keyRef.current = "";
      seenRef.current = null;
      await reload({ fresh: true });
    } catch (err) {
      setDecisions((current) => {
        const next = { ...current };
        for (const hunk of pendingHunks) {
          delete next[hunk.hunkId];
        }
        return next;
      });
      setOpenIds((current) => {
        const next = { ...current };
        for (const hunk of pendingHunks) {
          next[hunk.hunkId] = true;
        }
        return next;
      });
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const commitRailEdit = async (hunkId: string) => {
    const taskId = snapshot?.taskId;
    const hunk = snapshot?.hunks.find((row) => row.hunkId === hunkId);
    const after = draftsRef.current[hunkId];
    if (!taskId || !hunk || after === undefined || after === hunk.after) {
      return;
    }
    try {
      await apiSendJson(apiBase, `/api/word-surface/hunks/${encodeURIComponent(hunkId)}/revise`, "POST", {
        taskId,
        after,
      });
      keyRef.current = "";
      seenRef.current = null;
      await reload({ fresh: true });
    } catch (err) {
      setActionError(errorMessage(err, "没能按右侧修订更新正文。"));
    }
  };

  const exportWord = async () => {
    const taskId = snapshot?.taskId;
    if (!taskId || actionBusy) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const body = await apiSendJson<
        {
          ok: true;
          outputPath: string;
          outputFileName: string;
          degraded?: boolean;
          trackWarning?: string;
        },
        { taskId: string; projectDir?: string }
      >(apiBase, "/api/word-surface/export", "POST", {
        taskId,
        ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
      });
      setExportPath(body.outputPath);
      if (body.trackWarning) {
        setExportNote(
          `已覆盖审阅稿 ${body.outputFileName}，但修订轨核对未通过：${body.trackWarning}只含已接受的修改。原件留在原地。`,
        );
      } else {
        setExportNote(
          body.degraded
            ? `已覆盖审阅稿 ${body.outputFileName}，修订痕迹没有完整落下。只含已接受的修改。原件留在原地。`
            : `已覆盖审阅稿 ${body.outputFileName}。只含已接受的修改。这一条已从在办拿掉。原件留在原地。`,
        );
      }
    } catch (err) {
      setActionError(errorMessage(err, "导出失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const addCommentFromSelection = async () => {
    const range = editorTextRange();
    const anchorText = range?.toString().trim() ?? "";
    const taskId = snapshot?.taskId;
    if (!taskId || !anchorText || actionBusy) {
      setActionError(taskId ? "请先选中要批注的正文。" : "请先在正文里改一处，形成修订任务后再加批注。");
      setSelectionMenu(null);
      return;
    }
    setSelectionMenu(null);
    setActionBusy(true);
    setActionError(null);
    try {
      const body = await apiSendJson<{ ok: true; comment: SurfaceComment }, { taskId: string; anchorText: string; body?: string }>(
        apiBase,
        "/api/word-surface/comments",
        "POST",
        { taskId, anchorText, body: "批注" },
      );
      setComments((current) => [...current, body.comment]);
    } catch (err) {
      setActionError(errorMessage(err, "没能加上批注。"));
    } finally {
      setActionBusy(false);
    }
  };

  const pending = snapshot?.summary.pending ?? 0;
  const accepted = snapshot?.summary.accepted ?? 0;
  const canExport = accepted > 0 && !actionBusy;
  const serverHunks = snapshot?.hunks ?? [];
  const railLive = liveEdits.filter(
    (edit) => !serverHunks.some((hunk) => hunk.before === edit.before && hunk.after === edit.after),
  );
  const railHunks = serverHunks.filter(
    (hunk) => !railLive.some((edit) => edit.before === hunk.before),
  );
  const lawyerName = snapshot?.lawyerDisplayName?.trim() || "律师";
  const pageSnapshotRef = useRef<WordSurfaceSnapshot | null>(snapshot);
  if (!dirtyPlainRef.current) {
    pageSnapshotRef.current = snapshot;
  }
  const pagePaintLive = useMemo(
    (): SurfacePaint => ({
      hunks: snapshot?.hunks ?? [],
      selectedId,
      drafts,
      onFocus: focusHunk,
      onPlainFocus,
      onPlainDirty: scheduleSync,
      onShowAllMarkup: showAllMarkup,
      markup,
    }),
    [drafts, focusHunk, markup, onPlainFocus, scheduleSync, selectedId, showAllMarkup, snapshot?.hunks],
  );
  if (!dirtyPlainRef.current || !pagePaintRef.current || pagePaintRef.current.markup !== pagePaintLive.markup) {
    pagePaintRef.current = pagePaintLive;
  }

  return (
    <div className="lm-word-surface" ref={rootRef} data-testid="lm-word-surface">
      <div className="lm-word-surface-main">
      <header className="lm-word-surface-bar">
        <div className="lm-word-surface-title">
          <span className="lm-word-surface-name">{fileName}</span>
          <span className="lm-word-surface-count">
            {snapshot
              ? pending > 0
                ? `核对 · ${pending} 处待定`
                : "核对 · 没有待定修订"
              : loadError
                ? "没打开"
                : "正在打开"}
          </span>
        </div>
        <div className="lm-word-surface-actions">
          <label className="lm-word-markup">
            <select
              className="lm-input lm-word-markup-select"
              aria-label="显示标记"
              data-testid="lm-word-markup"
              value={markup}
              onChange={(event) => setMarkup(event.target.value as MarkupMode)}
            >
              <option value="all">所有标记</option>
              <option value="simple">简单标记</option>
              <option value="none">无标记</option>
              <option value="original">原始状态</option>
            </select>
          </label>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            disabled={busy}
            onClick={onRevealSource}
          >
            在访达中显示
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            disabled={busy}
            onClick={() => {
              void openDeliverableInWps(relPath).then((result) => {
                if (!result.ok && result.error) {
                  setActionError(result.error);
                }
              });
            }}
          >
            用本机应用打开
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            data-testid="lm-word-surface-export"
            disabled={!canExport}
            title={
              accepted > 0
                ? "覆盖旁边那份审阅稿。没接受的修订不会写入。原件留在原地。"
                : "先接受要留下的修改。没决定的不会写入。"
            }
            onClick={() => void exportWord()}
          >
            导出并覆盖审阅稿
          </button>
        </div>
      </header>
      {exportNote ? (
        <div className="lm-word-surface-note" role="status">
          <span>{exportNote}</span>
          {exportPath ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => void window.lawmindDesktop?.showItemInFolder(exportPath)}
            >
              显示导出文件
            </button>
          ) : null}
        </div>
      ) : null}
      {actionError ? (
        <p className="lm-word-surface-error" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="lm-word-surface-body">
      <div
        className="lm-word-surface-desk lm-scroll"
        onMouseUp={() => showSelectionMenu()}
        onContextMenu={(event) => {
          event.preventDefault();
          const range = editorTextRange();
          const anchor = range?.commonAncestorContainer;
          const el = anchor instanceof Element ? anchor : anchor?.parentElement;
          setSelectionMenu({
            x: event.clientX,
            y: event.clientY,
            inDeletion: Boolean(el?.closest("del")),
            fileActions: true,
          });
        }}
      >
      <WordSurfaceDocument
        key={pageEpoch}
        fileName={fileName}
        loadError={loadError}
        snapshot={pageSnapshotRef.current}
        paint={pagePaintRef.current}
      />
      </div>
      <div
        className="lm-split-handle lm-split-handle-vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整修订栏宽度"
        title="拖动调整修订栏宽度"
        data-testid="lm-word-surface-rail-split"
        onPointerDown={onRailResize}
      />
      <aside
        className="lm-word-surface-rail"
        aria-label="修订"
        style={{ width: railWidth, flexBasis: railWidth }}
      >
          <h2 className="lm-word-surface-rail-title">
            <span>修订</span>
            <span className="lm-word-rev-bulk">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-word-prev"
                disabled={!snapshot || snapshot.hunks.length === 0}
                onClick={() => stepRevision(-1)}
              >
                上一条
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-word-next"
                disabled={!snapshot || snapshot.hunks.length === 0}
                onClick={() => stepRevision(1)}
              >
                下一条
              </button>
              {pending > 0 ? (
                <>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    data-testid="lm-word-accept-all"
                    disabled={actionBusy}
                    onClick={() => void decideAll("accept")}
                  >
                    全部接受
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    data-testid="lm-word-reject-all"
                    disabled={actionBusy}
                    onClick={() => void decideAll("reject")}
                  >
                    全部拒绝
                  </button>
                </>
              ) : null}
            </span>
          </h2>
          <div className="lm-word-surface-rail-margin lm-scroll">
          {railLive.length === 0 && railHunks.length === 0 && comments.length === 0 ? (
            <p className="lm-word-surface-empty">
              右侧是待核对的修订。接受要留下的，再导出覆盖旁边的审阅稿。没决定的不会写入。原件留在原地。
            </p>
          ) : markup !== "all" ? (
            <p className="lm-word-surface-empty">
              {markup === "simple"
                ? "简单标记只保留左侧修订线。点红线跳到该段修订。"
                : markup === "none"
                  ? "无标记显示接受后的正文。"
                  : "原始状态显示修订前的正文。"}
            </p>
          ) : (
            <>
            {railLive.map((edit) => (
              <section
                key={edit.key}
                className="lm-word-rev-card"
                data-word-slot="rail"
                data-testid={`lm-word-live-${edit.key}`}
              >
                <p className="lm-word-rev-byline">{lawyerName}</p>
                <div className="lm-word-rev-preview">
                  {wordBalloonLines(edit.before, edit.after).map((line, lineIndex) => (
                    <p key={lineIndex} className="lm-word-rev-balloon-line">
                      <span className="lm-word-rev-balloon-label">{line.label}</span>
                      {line.mark === "del" ? (
                        <del className="lm-word-rev-del">{line.text}</del>
                      ) : (
                        <BalloonEdit
                          text={line.text}
                          editable
                          testId={`lm-word-live-edit-${edit.key}`}
                          onChange={(text) => {
                            const page = rootRef.current?.querySelector(".lm-word-surface-page");
                            const index = Number(edit.key.slice("live-".length));
                            const node = page?.querySelectorAll<HTMLElement>("[data-baseline]")[index];
                            const ins = node
                              ? [...node.querySelectorAll("ins")].find((el) => !el.closest(".lm-word-rev"))
                              : null;
                            if (!ins || !page) {
                              return;
                            }
                            ins.textContent = text;
                            setLiveEdits(readLiveEdits(page));
                          }}
                          onBlur={() => scheduleSync()}
                        />
                      )}
                    </p>
                  ))}
                </div>
              </section>
            ))}
            {railHunks.map((hunk) => {
              const afterText = liveAfter(drafts, hunk.hunkId, hunk.after);
              const decided = Object.hasOwn(decisions, hunk.hunkId) ? decisions[hunk.hunkId] : undefined;
              const shownStatus = decided ?? hunk.status;
              if (afterText === hunk.before && !(hunk.rationale ?? "").startsWith("设置格式")) {
                return null;
              }
              const reviewed = shownStatus !== "pending";
              const open = openIds[hunk.hunkId] ?? !reviewed;
              const foldLabel = shownStatus === "accepted" ? "已接受" : shownStatus === "rejected" ? "已拒绝" : "待定";
              return (
                <section
                  key={hunk.hunkId}
                  className={`lm-word-rev-card${selectedId === hunk.hunkId ? " lm-word-rev-card-active" : ""}${reviewed && !open ? " lm-word-rev-card-done" : ""}`}
                  data-word-hunk={hunk.hunkId}
                  data-word-slot="rail"
                  data-rev-color={String(hunk.color ?? revisionColor(serverHunks, hunk.hunkId))}
                  data-testid={`lm-word-hunk-${hunk.hunkId}`}
                  onClick={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("button, textarea, a, .lm-word-rev-edit")) {
                      return;
                    }
                    focusHunk(hunk.hunkId, "page");
                  }}
                >
                  {open ? (
                    <>
                      <div className="lm-word-rev-card-head">
                        <p className="lm-word-rev-byline">
                          {hunk.author ?? "审阅"}
                          {hunk.revisedAt ? `，${formatRevisionTime(hunk.revisedAt)}` : ""}
                        </p>
                        <div className="lm-word-rev-card-actions">
                          {reviewed ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              onClick={() => setOpenIds((current) => ({ ...current, [hunk.hunkId]: false }))}
                            >
                              收起
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="lm-btn lm-btn-sm"
                            data-testid={`lm-word-accept-${hunk.hunkId}`}
                            aria-label="接受"
                            title="接受修订"
                            aria-pressed={shownStatus === "accepted"}
                            disabled={actionBusy}
                            onClick={() => void decide(hunk.hunkId, "accept")}
                          >
                            接受
                          </button>
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            data-testid={`lm-word-reject-${hunk.hunkId}`}
                            aria-label="拒绝"
                            title="拒绝修订"
                            aria-pressed={shownStatus === "rejected"}
                            disabled={actionBusy}
                            onClick={() => void decide(hunk.hunkId, "reject")}
                          >
                            拒绝
                          </button>
                        </div>
                      </div>
                      <div className="lm-word-rev-preview">
                        {wordBalloonLines(hunk.before, afterText, hunk.rationale).map((line, lineIndex) => (
                          <p key={lineIndex} className="lm-word-rev-balloon-line">
                            <span className="lm-word-rev-balloon-label">{line.label}</span>
                            {line.mark === "del" ? (
                              <del className="lm-word-rev-del">{line.text}</del>
                            ) : (
                              <BalloonEdit
                                text={line.text}
                                editable={hunk.status === "pending"}
                                testId={`lm-word-edit-${hunk.hunkId}`}
                                onChange={(text) => {
                                  const next = replaceChangeAfter(hunk.before, afterText, line.changeIndex, text);
                                  draftsRef.current = { ...draftsRef.current, [hunk.hunkId]: next };
                                  setSelectedId(hunk.hunkId);
                                  setDrafts(draftsRef.current);
                                }}
                                onBlur={() => void commitRailEdit(hunk.hunkId)}
                              />
                            )}
                          </p>
                        ))}
                      </div>
                      {!hunk.placed ? <p className="lm-word-rev-unplaced">未在正文中找到</p> : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="lm-word-rev-fold"
                      data-testid={`lm-word-fold-${hunk.hunkId}`}
                      onClick={() => {
                        setOpenIds((current) => ({ ...current, [hunk.hunkId]: true }));
                        focusHunk(hunk.hunkId, "page");
                      }}
                    >
                      <span className="lm-word-rev-fold-mark" aria-hidden="true">
                        {shownStatus === "accepted" ? "✓" : "✕"}
                      </span>
                      <span className="lm-word-rev-fold-text">
                        {foldLabel} · {changeSummary(hunk.before, hunk.after)}
                      </span>
                    </button>
                  )}
                </section>
              );
            })}
            {comments.map((comment) => (
              <section
                key={comment.commentId}
                className="lm-word-rev-card lm-word-comment-card"
                data-testid={`lm-word-comment-${comment.commentId}`}
              >
                <div className="lm-word-rev-card-head">
                  <p className="lm-word-rev-byline">
                    {comment.author}
                    {comment.createdAt ? `，${formatRevisionTime(comment.createdAt)}` : ""}
                    {" · 批注"}
                  </p>
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    data-testid={`lm-word-comment-remove-${comment.commentId}`}
                    disabled={actionBusy}
                    onClick={() => {
                      const taskId = snapshot?.taskId;
                      if (!taskId) {
                        return;
                      }
                      void apiSendJson(
                        apiBase,
                        `/api/word-surface/comments/${encodeURIComponent(comment.commentId)}?taskId=${encodeURIComponent(taskId)}`,
                        "DELETE",
                      )
                        .then(() => {
                          setComments((current) =>
                            current.filter((row) => row.commentId !== comment.commentId),
                          );
                        })
                        .catch((err) => {
                          setActionError(errorMessage(err, "没能删除批注。"));
                        });
                    }}
                  >
                    删除
                  </button>
                </div>
                <p className="lm-word-comment-anchor">「{comment.anchorText}」</p>
                <div
                  className="lm-word-comment-body lm-word-rev-edit"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label="批注内容"
                  data-testid={`lm-word-comment-body-${comment.commentId}`}
                  spellCheck={false}
                  onBlur={(event) => {
                    const taskId = snapshot?.taskId;
                    const body = event.currentTarget.textContent ?? "";
                    if (!taskId || body === comment.body) {
                      return;
                    }
                    void apiSendJson(
                      apiBase,
                      `/api/word-surface/comments/${encodeURIComponent(comment.commentId)}`,
                      "POST",
                      { taskId, body },
                    )
                      .then((res) => {
                        const updated = (res as { comment?: SurfaceComment }).comment;
                        if (updated) {
                          setComments((current) =>
                            current.map((row) =>
                              row.commentId === comment.commentId ? updated : row,
                            ),
                          );
                        }
                      })
                      .catch((err) => {
                        setActionError(errorMessage(err, "没能保存批注。"));
                      });
                  }}
                >
                  {comment.body}
                </div>
              </section>
            ))}
            </>
          )}
          </div>
      </aside>
      </div>
      </div>
      {selectionMenu ? (
        <div
          className={`lm-word-selection-menu${selectionMenu.fileActions ? " lm-word-selection-menu-stack" : ""}`}
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
          role="menu"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {selectionMenu.fileActions ? (
            <>
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-surface-reveal"
                onClick={() => {
                  setSelectionMenu(null);
                  onRevealSource();
                }}
              >
                去本机文件所在目录
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-surface-wps"
                onClick={() => {
                  setSelectionMenu(null);
                  void openDeliverableInWps(relPath).then((result) => {
                    if (!result.ok && result.error) {
                      setActionError(result.error);
                    }
                  });
                }}
              >
                用本机应用打开
              </button>
            </>
          ) : selectionMenu.inDeletion ? (
            <>
              <button type="button" role="menuitem" data-testid="lm-word-surface-unstrike" onClick={unstrikeSelection}>
                取消删除线
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-surface-comment"
                onClick={() => void addCommentFromSelection()}
              >
                批注
              </button>
            </>
          ) : (
            <>
              <button type="button" role="menuitem" data-testid="lm-word-surface-strike" onClick={strikeSelection}>
                删除线
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-surface-comment"
                onClick={() => void addCommentFromSelection()}
              >
                批注
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

type SurfacePaint = {
  hunks: WordSurfaceHunkView[];
  selectedId: string | null;
  drafts: Record<string, string>;
  onFocus: (hunkId: string, slot: "page" | "rail") => void;
  onPlainFocus: (active: boolean) => void;
  onPlainDirty: () => void;
  /** Optional hunkId: jump to that revision after switching to all markup. */
  onShowAllMarkup: (hunkId?: string) => void;
  markup: MarkupMode;
  /** False for vertical table cells — keep them read-only. */
  plainEditable?: boolean;
};

const WordSurfaceDocument = memo(function WordSurfaceDocument(props: {
  fileName: string;
  loadError: string | null;
  snapshot: WordSurfaceSnapshot | null;
  paint: SurfacePaint;
}): ReactNode {
  const { fileName, loadError, snapshot, paint } = props;
  const empty = Boolean(
    snapshot &&
      snapshot.paragraphs.every((paragraph) =>
        paragraph.segments.every((segment) => segment.kind === "text" && !segment.text.trim()),
      ),
  );
  return (
    <article className="lm-word-surface-page" style={pageStyle(snapshot?.page)} aria-label={fileName}>
      {loadError && !snapshot ? (
        <p className="lm-word-surface-empty">{loadError}</p>
      ) : empty ? (
        <p className="lm-word-surface-empty">这份 Word 没有可抽出的正文。</p>
      ) : (
        renderSurfaceBlocks(
          snapshot?.blocks?.length
            ? snapshot.blocks
            : (snapshot?.paragraphs ?? []).map((paragraph) => ({ kind: "paragraph" as const, ...paragraph })),
          paint,
          snapshot?.page,
        )
      )}
    </article>
  );
});

function renderSurfaceBlocks(
  blocks: WordSurfaceBlock[],
  paint: SurfacePaint,
  page?: WordPageBox,
): ReactNode {
  return blocks.map((block, index) => {
    if (block.kind !== "table") {
      return renderSurfaceParagraph(block, index, paint);
    }
    const cols = scaledColWidths(block, page);
    return (
      <table
        key={index}
        className={`lm-word-surface-table${block.bordered ? " lm-word-surface-table-grid" : ""}`}
        style={tableStyle(block, page)}
      >
        {cols ? (
          <colgroup>
            {cols.map((width, colIndex) => (
              <col key={colIndex} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => {
                const cellPaint: SurfacePaint = {
                  ...paint,
                  plainEditable: !cell.vertical,
                };
                return (
                  <td
                    key={cellIndex}
                    colSpan={cell.colspan}
                    style={cellStyle(cell)}
                    data-word-cell={cell.vertical ? "vertical" : "plain"}
                  >
                    {renderSurfaceBlocks(cell.blocks, cellPaint, page)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  });
}

function contentWidthPx(page: WordPageBox | undefined): number | undefined {
  if (!page) {
    return undefined;
  }
  return Math.max(0, page.widthPx - page.marginLeftPx - page.marginRightPx);
}

function scaledColWidths(
  block: Extract<WordSurfaceBlock, { kind: "table" }>,
  page: WordPageBox | undefined,
): number[] | undefined {
  const cols = block.colWidthsPx;
  if (!cols || cols.length === 0) {
    return undefined;
  }
  if (block.widthPx != null) {
    return cols;
  }
  const target =
    block.widthPct != null ? ((contentWidthPx(page) ?? 0) * block.widthPct) / 100 : contentWidthPx(page);
  if (!target || target <= 0) {
    return cols;
  }
  const sum = cols.reduce((total, width) => total + width, 0);
  if (sum <= 0) {
    return cols;
  }
  const factor = target / sum;
  return cols.map((width) => Math.round(width * factor * 10) / 10);
}

function tableStyle(
  block: Extract<WordSurfaceBlock, { kind: "table" }>,
  page: WordPageBox | undefined,
): CSSProperties | undefined {
  const cols = scaledColWidths(block, page);
  if (block.widthPx != null) {
    return { width: block.widthPx, minWidth: block.widthPx };
  }
  if (block.widthPct != null) {
    return { width: `${block.widthPct}%` };
  }
  if (cols && cols.length > 0) {
    return { width: cols.reduce((sum, width) => sum + width, 0) };
  }
  return { width: "100%" };
}

function cellStyle(cell: {
  widthPx?: number;
  vertical?: boolean;
  vAlign?: "top" | "center" | "bottom";
  colspan?: number;
}): CSSProperties {
  const style: CSSProperties = {};
  if (cell.vAlign) {
    style.verticalAlign = cell.vAlign;
  }
  if (cell.vertical) {
    style.writingMode = "vertical-rl";
    style.textOrientation = "upright";
    style.whiteSpace = "nowrap";
    style.textAlign = "center";
  } else {
    style.wordBreak = "keep-all";
    style.overflowWrap = "normal";
  }
  return style;
}

type SelectionMenu = { x: number; y: number; inDeletion: boolean; fileActions: boolean };

function editorTextRange(): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString()) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  if (!el?.closest(".lm-word-surface-plain")) {
    return null;
  }
  return range;
}

function paragraphBaseline(paragraph: WordSurfaceParagraph): string {
  if (paragraph.baselineText != null) {
    return paragraph.baselineText;
  }
  return paragraph.segments.map((segment) => (segment.kind === "text" ? segment.text : segment.before)).join("");
}

function paintedInsertionEdits(
  page: ParentNode,
  hunks: WordSurfaceHunkView[],
  drafts: Record<string, string>,
): { hunkId: string; after: string }[] {
  const edits: { hunkId: string; after: string }[] = [];
  for (const hunk of hunks) {
    if (hunk.status !== "pending") {
      continue;
    }
    const nodes = [
      ...page.querySelectorAll<HTMLElement>(
        `[data-word-hunk="${CSS.escape(hunk.hunkId)}"][data-word-slot="page"]`,
      ),
    ];
    if (nodes.length === 0) {
      continue;
    }
    const currentAfter = drafts[hunk.hunkId] ?? hunk.after;
    let after = currentAfter;
    let changed = false;
    nodes.forEach((node, index) => {
      const ins = node.querySelector("ins");
      if (!ins) {
        return;
      }
      const expected = node.dataset.revAfter ?? "";
      const text = ins.textContent ?? "";
      if (text === expected) {
        return;
      }
      const changeIndex = Number(node.dataset.changeIndex ?? String(index));
      after =
        expected === currentAfter
          ? text
          : replaceChangeAfter(hunk.before, after, Number.isFinite(changeIndex) ? changeIndex : index, text);
      changed = true;
    });
    if (changed && after !== currentAfter) {
      edits.push({ hunkId: hunk.hunkId, after });
    }
  }
  return edits;
}

function readLiveEdits(page: ParentNode): LiveEdit[] {
  return [...page.querySelectorAll<HTMLElement>("[data-baseline]")].flatMap((node, index) => {
    const before = node.dataset.baseline ?? "";
    const after = visibleResultText(node);
    if (!before.trim() || before === after) {
      return [];
    }
    return [{ key: `live-${index}`, before, after }];
  });
}

/** Result text for sync: drop lawyer deletion marks; keep pending rail revisions as original. */
function visibleResultText(editor: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node instanceof HTMLElement) {
      if (node.classList.contains("lm-word-rev")) {
        const original = node.querySelector(":scope > .lm-word-rev-del");
        out += original?.textContent ?? "";
        return;
      }
      if (node.tagName === "DEL") {
        return;
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    node.childNodes.forEach(walk);
  };
  walk(editor);
  return out;
}

function wordBalloonLines(
  before: string,
  after: string,
  rationale?: string,
): { label: string; text: string; mark: "del" | "ins" | "fmt"; changeIndex: number }[] {
  if (rationale?.startsWith("设置格式")) {
    return [{ label: rationale, text: after || before, mark: "fmt", changeIndex: 0 }];
  }
  const moved = rationale === "移动的内容";
  const lines: { label: string; text: string; mark: "del" | "ins" | "fmt"; changeIndex: number }[] = [];
  let changeIndex = 0;
  for (const piece of revisionPieces(before, after)) {
    if (piece.kind !== "change") {
      continue;
    }
    if (piece.before) {
      lines.push({
        label: moved ? "移动来源" : "删除的内容",
        text: piece.before,
        mark: "del",
        changeIndex,
      });
    }
    if (piece.after) {
      lines.push({
        label: moved ? "移动目标" : "插入的内容",
        text: piece.after,
        mark: "ins",
        changeIndex,
      });
    }
    changeIndex += 1;
  }
  return lines;
}

function BalloonEdit(props: {
  text: string;
  editable: boolean;
  testId: string;
  onChange: (text: string) => void;
  onBlur: () => void;
}): ReactNode {
  const ref = useRef<HTMLModElement>(null);
  const focused = useRef(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || focused.current) {
      return;
    }
    if (node.textContent !== props.text) {
      node.textContent = props.text;
    }
  }, [props.text]);
  return (
    <ins
      ref={ref}
      className="lm-word-rev-ins lm-word-rev-edit"
      contentEditable={props.editable}
      suppressContentEditableWarning
      role="textbox"
      aria-label="修改这条修订"
      data-testid={props.testId}
      spellCheck={false}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onFocus={() => {
        focused.current = true;
      }}
      onInput={(event) => props.onChange(event.currentTarget.textContent ?? "")}
      onBlur={() => {
        focused.current = false;
        props.onBlur();
      }}
    />
  );
}

function formatRevisionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function changeSummary(before: string, after: string): string {
  const bits = revisionPieces(before, after)
    .filter((piece) => piece.kind === "change")
    .map((piece) => {
      if (piece.kind !== "change") {
        return "";
      }
      if (piece.before && piece.after) {
        return `${piece.before} → ${piece.after}`;
      }
      return piece.after || piece.before;
    })
    .filter(Boolean);
  return (bits.join("；") || after || before).replace(/\s+/g, " ").trim();
}

function liveRevisionPiece(
  segments: WordSurfaceParagraph["segments"],
  segIndex: number,
  segment: Extract<WordSurfaceSegment, { kind: "revision" }>,
  paint: SurfacePaint,
): { before: string; after: string } {
  const hunk = paint.hunks.find((row) => row.hunkId === segment.hunkId);
  if (!hunk || paint.drafts[segment.hunkId] === undefined) {
    return { before: segment.before, after: segment.after };
  }
  const changes = revisionPieces(hunk.before, liveAfter(paint.drafts, segment.hunkId, hunk.after)).filter(
    (piece) => piece.kind === "change",
  );
  const prior = segments
    .slice(0, segIndex)
    .filter((row) => row.kind === "revision" && row.hunkId === segment.hunkId).length;
  const piece = changes[prior];
  return piece && piece.kind === "change"
    ? { before: piece.before, after: piece.after }
    : { before: segment.before, after: segment.after };
}

function renderRevisionSpan(
  segments: WordSurfaceParagraph["segments"],
  segIndex: number,
  segment: Extract<WordSurfaceSegment, { kind: "revision" }>,
  paint: SurfacePaint,
): ReactNode {
  const piece = liveRevisionPiece(segments, segIndex, segment, paint);
  const changeIndex = segments
    .slice(0, segIndex)
    .filter((row) => row.kind === "revision" && row.hunkId === segment.hunkId).length;
  const mode = paint.markup;
  if (piece.before === piece.after) {
    return (
      <span
        key={segIndex}
        className={`lm-word-rev lm-word-rev-fmt${paint.selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
        data-word-hunk={segment.hunkId}
        data-word-slot="page"
        data-rev-after={piece.after}
        data-change-index={String(changeIndex)}
        data-rev-color={String(segment.color ?? revisionColor(paint.hunks, segment.hunkId))}
        onClick={() => paint.onFocus(segment.hunkId, "rail")}
      >
        {piece.after}
      </span>
    );
  }
  if (mode === "original" || mode === "simple" || mode === "none") {
    return <span key={segIndex}>{mode === "original" ? piece.before : piece.after}</span>;
  }
  return (
    <span
      key={segIndex}
      className={`lm-word-rev${paint.selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
      style={markStyle(segment, true)}
      data-word-hunk={segment.hunkId}
      data-word-slot="page"
      data-rev-after={piece.after}
      data-change-index={String(changeIndex)}
      data-rev-color={String(segment.color ?? revisionColor(paint.hunks, segment.hunkId))}
      onClick={() => paint.onFocus(segment.hunkId, "rail")}
    >
      {piece.before ? <del className="lm-word-rev-del">{piece.before}</del> : null}
      {piece.after ? <ins className="lm-word-rev-ins">{piece.after}</ins> : null}
    </span>
  );
}

function renderSurfaceParagraph(paragraph: WordSurfaceParagraph, index: number, paint: SurfacePaint): ReactNode {
  const blank = paragraph.segments.every((segment) => segment.kind === "text" && !segment.text.trim());
  const revised =
    paint.markup !== "none" &&
    paint.markup !== "original" &&
    paragraph.segments.some((segment) => segment.kind === "revision");
  const revisionIds = paragraph.segments
    .filter((segment): segment is Extract<WordSurfaceSegment, { kind: "revision" }> => segment.kind === "revision")
    .map((segment) => segment.hunkId);
  const editable = paint.plainEditable !== false;
  return (
    <p
      key={index}
      className={`lm-word-surface-p${blank ? " lm-word-surface-blank" : ""}${revised ? " lm-word-surface-p-revised" : ""}`}
      style={paragraphStyle(paragraph)}
      data-testid={editable ? undefined : "lm-word-surface-p-readonly"}
    >
      {paint.markup === "simple" && revised ? (
        <button
          type="button"
          className="lm-word-rev-bar"
          aria-label="显示此段修订"
          data-testid="lm-word-rev-bar"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (revisionIds.length === 0) {
              paint.onShowAllMarkup();
              return;
            }
            const current =
              paint.selectedId && revisionIds.includes(paint.selectedId)
                ? revisionIds.indexOf(paint.selectedId)
                : -1;
            const next = revisionIds[(current + 1) % revisionIds.length];
            paint.onShowAllMarkup(next);
          }}
        />
      ) : null}
      {paragraph.listLabel ? <span className="lm-word-surface-label">{paragraph.listLabel}</span> : null}
      <span
        className="lm-word-surface-plain"
        data-baseline={paragraphBaseline(paragraph)}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-label="修改这段正文"
        onFocus={() => {
          if (editable) {
            paint.onPlainFocus(true);
          }
        }}
        onBlur={(event) => {
          if (!editable) {
            return;
          }
          const next = event.relatedTarget;
          const staying = next instanceof Element && next.closest(".lm-word-surface-page") !== null;
          paint.onPlainFocus(staying);
        }}
        onInput={() => {
          if (editable) {
            paint.onPlainDirty();
          }
        }}
      >
        {paragraph.segments.map((segment, segIndex) =>
          segment.kind === "text" ? (
            <span key={segIndex} style={markStyle(segment, false)}>
              {segment.text}
            </span>
          ) : (
            renderRevisionSpan(paragraph.segments, segIndex, segment, paint)
          ),
        )}
      </span>
    </p>
  );
}
