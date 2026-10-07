/**
 * Open .docx in the chat middle column as Word Review: one tracked-change
 * model, by-author colors. Accept folds and keeps the mark for export; reject
 * removes it. Other lawyers' marks are visible only.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  replaceChangeAfter,
  trackCoversHunk,
} from "../../../../../src/lawmind/drafts/word-surface-pieces.ts";
import type {
  WordSurfaceHunkView,
  WordSurfaceSnapshot,
  WordTrackedView,
} from "../../../../../src/lawmind/drafts/word-surface.ts";
import { WordSurfaceDocument, type SurfacePaint } from "./word-surface-document-view";
import {
  BalloonEdit,
  formatRevisionTime,
  HunkBalloon,
  TrackBalloon,
  wordBalloonLines,
} from "./word-surface-margin";
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
import type { WordRevisionRun } from "../../../../../src/lawmind/drafts/word-revision/index.ts";
import {
  acceptParagraphTracks,
  applyEngineDelete,
  applyEngineFormat,
  applyEngineInsert,
  applyEngineMove,
  authorClockFor,
  editHitsForeignTrack,
  caretEngineOffset,
  isOwnRevisionAuthor,
  ownRevisionName,
  commentOnRange,
  decideParagraphRuns,
  paragraphRunsOf,
  restoreCaret,
  snapshotHasEngine,
  snapshotWithRuns,
} from "./word-surface-engine";
import { packRailCardTops } from "./word-surface-rail";
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

function revisionCardStatus(
  id: string,
  hunks: WordSurfaceHunkView[],
  tracked: WordTrackedView[],
): "pending" | "accepted" | "rejected" {
  const hunk = hunks.find((row) => row.hunkId === id);
  if (hunk) {
    return hunk.status;
  }
  const track = tracked.find((row) => row.revId === id);
  if (!track) {
    return "pending";
  }
  if (track.disposition === "accepted") {
    return "accepted";
  }
  const covered = hunks.find((row) => trackCoversHunk(track, row));
  return covered?.status ?? "pending";
}

function idsCoveredWithTrack(
  row: WordTrackedView,
  hunks: WordSurfaceHunkView[],
  tracked: WordTrackedView[],
): string[] {
  const hunkMatches = hunks.filter((hunk) => trackCoversHunk(row, hunk));
  const ids = new Set<string>([row.revId, ...hunkMatches.map((hunk) => hunk.hunkId)]);
  for (const other of tracked) {
    if (hunkMatches.some((hunk) => trackCoversHunk(other, hunk))) {
      ids.add(other.revId);
    }
  }
  return [...ids];
}

function snapshotKey(snap: WordSurfaceSnapshot): string {
  return JSON.stringify({
    taskId: snap.taskId,
    updatedAt: snap.updatedAt,
    blocks: snap.blocks,
    page: snap.page,
    paragraphs: snap.paragraphs,
    hunks: snap.hunks.map((hunk) => [hunk.hunkId, hunk.status, hunk.color, hunk.before, hunk.after, hunk.placed]),
    tracked: (snap.tracked ?? []).map((row) => [
      row.revId,
      row.change,
      row.author,
      row.text,
      row.color,
      row.disposition ?? "",
    ]),
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


export function LawmindWordRevisionSurface(props: LawmindWordRevisionSurfaceProps): ReactNode {
  const { apiBase, projectDir, root, relPath, fileName, busy = false, onRevealSource } = props;
  const [snapshot, setSnapshot] = useState<WordSurfaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [liveEdits, setLiveEdits] = useState<LiveEdit[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    inDeletion: boolean;
    fileActions: boolean;
  } | null>(null);
  const [markup, setMarkup] = useState<MarkupMode>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
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
  const pendingCaretRef = useRef<{ index: number; offset: number } | null>(null);
  const compositionCaretRef = useRef<{ index: number; offset: number } | null>(null);
  const engineUndoRef = useRef<WordRevisionRun[][][]>([]);
  const pendingMoveRef = useRef<{ index: number; start: number; end: number; text: string } | null>(null);
  const followSelRef = useRef<string | null>(null);
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

  const persistDocument = useCallback(
    async (opts?: { force?: boolean }) => {
      const current = snapshotRef.current;
      const runs = paragraphRunsOf(current);
      if (snapshotHasEngine(current) && apiBase.trim()) {
        try {
          await apiSendJson(apiBase, "/api/word-surface/save", "POST", {
            root,
            path: relPath,
            paragraphs: runs,
            ...(current?.docxComments && current.docxComments.length > 0
              ? { comments: current.docxComments }
              : {}),
            ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
          });
          keyRef.current = "";
          seenRef.current = null;
          dirtyPlainRef.current = false;
          editingPlainRef.current = false;
          await reload({ fresh: true });
        } catch (err) {
          setActionError(errorMessage(err, "没能写回这份文件。"));
        }
        return;
      }
      await syncDocument(opts);
    },
    [apiBase, projectDir, relPath, reload, root, syncDocument],
  );

  const markPlainDirty = useCallback(() => {
    editingPlainRef.current = true;
    dirtyPlainRef.current = true;
  }, []);

  const scheduleSync = useCallback(() => {
    markPlainDirty();
    if (!composingRef.current && !snapshotHasEngine(snapshotRef.current)) {
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
      void persistDocument();
    }, SYNC_DEBOUNCE_MS);
  }, [markPlainDirty, persistDocument]);

  useEffect(() => {
    return () => {
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
      }
    };
  }, []);

  const syncDocumentRef = useRef(persistDocument);
  syncDocumentRef.current = persistDocument;

  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) {
      return;
    }
    pendingCaretRef.current = null;
    const editor = rootRef.current?.querySelector(
      `[data-paragraph-index="${String(pending.index)}"]`,
    );
    if (editor instanceof HTMLElement) {
      restoreCaret(editor, pending.offset);
    }
  }, [snapshot]);

  const commitEngineRuns = useCallback(
    (paragraphs: WordRevisionRun[][], caret?: { index: number; offset: number }) => {
      const current = snapshotRef.current;
      if (!current) {
        return;
      }
      engineUndoRef.current = [...engineUndoRef.current, paragraphRunsOf(current)].slice(-50);
      const next = snapshotWithRuns(current, paragraphs);
      snapshotRef.current = next;
      pageSnapshotRef.current = next;
      setSnapshot(next);
      if (caret) {
        pendingCaretRef.current = caret;
      }
      dirtyPlainRef.current = true;
      scheduleSync();
    },
    [scheduleSync],
  );

  const hiddenAuthorsOf = useCallback((current: WordSurfaceSnapshot | null): Set<string> | undefined => {
    if (authorFilter === "all") {
      return undefined;
    }
    return new Set((current?.authors ?? []).filter((name) => name !== authorFilter));
  }, [authorFilter]);

  const engineContext = useCallback(
    (node: Node | null) => {
      const current = snapshotRef.current;
      if (!current || !snapshotHasEngine(current) || !node) {
        return null;
      }
      const el = node instanceof Element ? node : node.parentElement;
      const editor = el?.closest<HTMLElement>("[data-paragraph-index]");
      if (!editor) {
        return null;
      }
      const index = Number(editor.dataset.paragraphIndex ?? "-1");
      if (!Number.isInteger(index) || index < 0) {
        return null;
      }
      const runs = paragraphRunsOf(current)[index] ?? [];
      const caret = caretEngineOffset(editor, runs, markup, hiddenAuthorsOf(current));
      return { current, editor, index, runs, caret };
    },
    [hiddenAuthorsOf, markup],
  );

  const applyEngineBeforeInput = useCallback(
    (event: InputEvent): boolean => {
      const ctx = engineContext(event.target instanceof Node ? event.target : null);
      if (!ctx || !ctx.caret) {
        return false;
      }
      const editKind = event.inputType.startsWith("delete")
        ? event.inputType.includes("Forward")
          ? "delete-forward"
          : "delete-back"
        : "insert";
      if (editHitsForeignTrack(ctx.runs, ctx.caret, ownRevisionName(ctx.current), editKind)) {
        event.preventDefault();
        return true;
      }
      if (event.inputType === "insertCompositionText" || event.isComposing) {
        compositionCaretRef.current = { index: ctx.index, offset: ctx.caret.start };
        return false;
      }
      event.preventDefault();
      setActionError(null);
      const author = authorClockFor(ctx.current);
      const paragraphs = paragraphRunsOf(ctx.current);
      if (event.inputType.startsWith("delete")) {
        const nextRuns = applyEngineDelete(
          ctx.runs,
          ctx.caret,
          !event.inputType.includes("Forward"),
          author,
        );
        paragraphs[ctx.index] = nextRuns;
        commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.start });
        return true;
      }
      if (!event.inputType.startsWith("insert")) {
        return true;
      }
      const text =
        event.inputType === "insertFromPaste" || event.inputType === "insertFromDrop"
          ? event.data || event.dataTransfer?.getData("text/plain") || ""
          : (event.data ?? "");
      if (!text) {
        return true;
      }
      const pendingMove = pendingMoveRef.current;
      if (
        event.inputType === "insertFromPaste" &&
        pendingMove &&
        pendingMove.text === text &&
        pendingMove.index === ctx.index
      ) {
        const nextRuns = applyEngineMove(
          ctx.runs,
          { start: pendingMove.start, end: pendingMove.end },
          ctx.caret.start,
          author,
        );
        pendingMoveRef.current = null;
        paragraphs[ctx.index] = nextRuns;
        commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.start + text.length });
        return true;
      }
      const nextRuns = applyEngineInsert(ctx.runs, ctx.caret, text, author);
      paragraphs[ctx.index] = nextRuns;
      commitEngineRuns(paragraphs, {
        index: ctx.index,
        offset: ctx.caret.start + text.length,
      });
      pendingMoveRef.current = null;
      return true;
    },
    [commitEngineRuns, engineContext],
  );

  const undoEngine = useCallback((): boolean => {
    const prior = engineUndoRef.current.pop();
    if (!prior || !snapshotRef.current) {
      return false;
    }
    const next = snapshotWithRuns(snapshotRef.current, prior);
    snapshotRef.current = next;
    pageSnapshotRef.current = next;
    setSnapshot(next);
    dirtyPlainRef.current = true;
    scheduleSync();
    return true;
  }, [scheduleSync]);

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

  const focusHunk = useCallback((hunkId: string, _slot: "page" | "rail") => {
    setSelectedId(hunkId);
    setOpenIds((current) => {
      const snap = snapshotRef.current;
      const next = { ...current, [hunkId]: true };
      const foreign = (snap?.tracked ?? []).filter((row) => !isOwnRevisionAuthor(row.author, snap));
      if (foreign.some((row) => row.revId === hunkId)) {
        for (const row of foreign) {
          if (row.revId !== hunkId) {
            next[row.revId] = false;
          }
        }
      }
      return next;
    });
    window.requestAnimationFrame(() => {
      const root = rootRef.current;
      const page = root?.querySelector(
        `[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="page"]`,
      );
      if (page) {
        page.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        return;
      }
      root
        ?.querySelector(`[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="rail"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
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
    const seen = new Set<string>();
    const ids = [
      ...(snapshot?.tracked ?? []).map((row) => row.revId),
      ...(snapshot?.hunks ?? []).map((hunk) => hunk.hunkId),
    ].filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
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
    const spacer = margin?.querySelector<HTMLElement>(".lm-word-rev-spacer");
    if (!root || !desk || !margin || !spacer || markup !== "all") {
      return undefined;
    }
    const place = () => {
      const cards = [...margin.querySelectorAll<HTMLElement>("[data-word-slot='rail']")];
      const packed = packRailCardTops(
        cards.map((card) => {
          const id = card.dataset.wordHunk ?? "";
          const page = id
            ? desk.querySelector<HTMLElement>(`[data-word-hunk="${CSS.escape(id)}"][data-word-slot="page"]`)
            : null;
          const sheet = desk.querySelector<HTMLElement>(".lm-word-surface-sheet") ?? desk;
          const origin = sheet.getBoundingClientRect().top;
          const wanted = page
            ? page.getBoundingClientRect().top - origin
            : Number.POSITIVE_INFINITY;
          return { wanted, height: card.offsetHeight };
        }),
      );
      cards.forEach((card, index) => {
        card.style.top = `${packed.tops[index] ?? 0}px`;
      });
      spacer.style.height = `${packed.height}px`;
    };
    place();
    if (selectedId && followSelRef.current !== selectedId) {
      followSelRef.current = selectedId;
      const rail = margin.querySelector<HTMLElement>(
        `[data-word-hunk="${CSS.escape(selectedId)}"][data-word-slot="rail"]`,
      );
      const page = desk.querySelector<HTMLElement>(
        `[data-word-hunk="${CSS.escape(selectedId)}"][data-word-slot="page"]`,
      );
      rail?.scrollIntoView({ block: "nearest" });
      page?.scrollIntoView({ block: "nearest" });
    }
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [comments, liveEdits, markup, openIds, selectedId, snapshot]);

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
        const ctx = engineContext(event.target instanceof Node ? event.target : window.getSelection()?.anchorNode ?? null);
        if (ctx?.caret && ctx.caret.end > ctx.caret.start) {
          event.preventDefault();
          if (editHitsForeignTrack(ctx.runs, ctx.caret, ownRevisionName(ctx.current), "delete-back")) {
            return;
          }
          const text = window.getSelection()?.toString() ?? "";
          rememberMove(text);
          pendingMoveRef.current = {
            index: ctx.index,
            start: ctx.caret.start,
            end: ctx.caret.end,
            text,
          };
          void navigator.clipboard?.writeText(text).catch(() => undefined);
          const paragraphs = paragraphRunsOf(ctx.current);
          paragraphs[ctx.index] = applyEngineDelete(ctx.runs, ctx.caret, true, authorClockFor(ctx.current));
          commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.start });
          return;
        }
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
        const format = key === "b" ? "加粗" : key === "i" ? "倾斜" : "下划线";
        const ctx = engineContext(event.target instanceof Node ? event.target : window.getSelection()?.anchorNode ?? null);
        if (ctx?.caret && ctx.caret.end > ctx.caret.start) {
          event.preventDefault();
          if (editHitsForeignTrack(ctx.runs, ctx.caret, ownRevisionName(ctx.current), "insert")) {
            return;
          }
          const paragraphs = paragraphRunsOf(ctx.current);
          paragraphs[ctx.index] = applyEngineFormat(ctx.runs, ctx.caret, format, authorClockFor(ctx.current));
          commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.end });
          return;
        }
        const range = editorTextRange();
        const selected = range?.toString() ?? "";
        if (!selected) {
          return;
        }
        event.preventDefault();
        const command = key === "b" ? "bold" : key === "i" ? "italic" : "underline";
        if (typeof document.execCommand === "function") {
          document.execCommand(command);
        }
        void recordFormat(format, selected);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.altKey) {
        event.preventDefault();
        if (snapshotHasEngine(snapshotRef.current) && !event.shiftKey && undoEngine()) {
          return;
        }
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
      void persistDocument({ force: true });
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
      if (applyEngineBeforeInput(event)) {
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
      const ctx = engineContext(event.target);
      if (ctx?.caret) {
        compositionCaretRef.current = { index: ctx.index, offset: ctx.caret.start };
      }
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
      const pending = compositionCaretRef.current;
      compositionCaretRef.current = null;
      const current = snapshotRef.current;
      if (committed && pending && snapshotHasEngine(current)) {
        const paragraphs = paragraphRunsOf(current);
        const runs = paragraphs[pending.index] ?? [];
        const nextRuns = applyEngineInsert(
          runs,
          { offset: pending.offset, start: pending.offset, end: pending.offset },
          committed,
          authorClockFor(current),
        );
        paragraphs[pending.index] = nextRuns;
        commitEngineRuns(paragraphs, {
          index: pending.index,
          offset: pending.offset + committed.length,
        });
        setActionError(null);
        return;
      }
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
  }, [
    applyEngineBeforeInput,
    commitEngineRuns,
    engineContext,
    persistDocument,
    recordFormat,
    scheduleSync,
    undoEngine,
    undoSyncedLawyerHunk,
  ]);

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
    const ctx = engineContext(window.getSelection()?.anchorNode ?? null);
    if (ctx?.caret && ctx.caret.end > ctx.caret.start) {
      const paragraphs = paragraphRunsOf(ctx.current);
      paragraphs[ctx.index] = applyEngineDelete(ctx.runs, ctx.caret, true, authorClockFor(ctx.current));
      commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.start });
      window.getSelection()?.removeAllRanges();
      setSelectionMenu(null);
      return;
    }
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
    const ctx = engineContext(window.getSelection()?.anchorNode ?? null);
    if (ctx?.caret && ctx.caret.end > ctx.caret.start) {
      const paragraphs = paragraphRunsOf(ctx.current);
      paragraphs[ctx.index] = applyEngineInsert(ctx.runs, ctx.caret, "", authorClockFor(ctx.current));
      commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.start });
      window.getSelection()?.removeAllRanges();
      setSelectionMenu(null);
      return;
    }
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

  const foldCards = (ids: string[]) => {
    setOpenIds((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = false;
      }
      return next;
    });
  };

  const unfoldCards = (ids: string[]) => {
    setOpenIds((current) => {
      const next = { ...current };
      for (const id of ids) {
        next[id] = true;
      }
      return next;
    });
  };

  const acceptTracksInSnapshot = (current: WordSurfaceSnapshot, revIds: string[]) => {
    const accepted = new Set(revIds);
    const next = snapshotHasEngine(current)
      ? snapshotWithRuns(current, acceptParagraphTracks(paragraphRunsOf(current), revIds))
      : { ...current };
    next.tracked = (next.tracked ?? []).map((row) =>
      accepted.has(row.revId) ? { ...row, disposition: "accepted" as const } : row,
    );
    next.hunks = current.hunks.map((hunk) =>
      accepted.has(hunk.hunkId) ? { ...hunk, status: "accepted" as const } : hunk,
    );
    snapshotRef.current = next;
    pageSnapshotRef.current = next;
    setSnapshot(next);
  };

  const rejectTracksInSnapshot = (current: WordSurfaceSnapshot, ids: string[]) => {
    const drop = new Set(ids);
    const next: WordSurfaceSnapshot = {
      ...current,
      hunks: current.hunks.map((hunk) =>
        drop.has(hunk.hunkId) ? { ...hunk, status: "rejected" as const } : hunk,
      ),
      tracked: (current.tracked ?? []).filter((row) => !drop.has(row.revId)),
    };
    snapshotRef.current = next;
    pageSnapshotRef.current = next;
    setSnapshot(next);
  };

  const postHunkResolve = async (taskId: string, hunkId: string, decision: "accept" | "reject") => {
    await apiSendJson(
      apiBase,
      `/api/drafts/${encodeURIComponent(taskId)}/redline/hunks/${encodeURIComponent(hunkId)}/resolve`,
      "POST",
      { decision },
    );
  };

  const persistRejectTracks = async (revIds: string[]) => {
    if (revIds.length === 0) {
      return;
    }
    const current = snapshotRef.current;
    const inBody = new Set(
      paragraphRunsOf(current).flatMap((runs) => runs.map((run) => run.track?.id).filter(Boolean)),
    );
    const bodyIds = revIds.filter((id) => inBody.has(id));
    const extra = revIds.filter((id) => !inBody.has(id));
    if (current && snapshotHasEngine(current) && bodyIds.length > 0) {
      let paragraphs = paragraphRunsOf(current);
      for (const id of bodyIds) {
        paragraphs = decideParagraphRuns(paragraphs, id, "reject");
      }
      const next = snapshotWithRuns(current, paragraphs);
      snapshotRef.current = next;
      pageSnapshotRef.current = next;
      setSnapshot(next);
      await persistDocument({ force: true });
    }
    if (extra.length > 0 || !(current && snapshotHasEngine(current) && bodyIds.length > 0)) {
      for (const id of extra.length > 0 ? extra : revIds) {
        await apiSendJson(apiBase, "/api/word-surface/tracked", "POST", {
          root,
          path: relPath,
          ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
          decision: "reject",
          revId: id,
        });
      }
      keyRef.current = "";
      seenRef.current = null;
      dirtyPlainRef.current = false;
      editingPlainRef.current = false;
      await reload({ fresh: true });
      const latest = snapshotRef.current;
      if (latest) {
        rejectTracksInSnapshot(latest, revIds);
      }
      setPageEpoch((value) => value + 1);
    }
  };

  const decide = async (hunkId: string, decision: "accept" | "reject") => {
    const taskId = snapshot?.taskId;
    const hunk = snapshot?.hunks.find((row) => row.hunkId === hunkId);
    if (!taskId || !hunk || actionBusy) {
      return;
    }
    const before = snapshot;
    const target = decision === "accept" ? "accepted" : "rejected";
    const tracked = snapshot.tracked ?? [];
    const ids = [
      hunkId,
      ...tracked.filter((row) => trackCoversHunk(row, hunk)).map((row) => row.revId),
    ];
    foldCards(ids);
    if (decision === "accept") {
      acceptTracksInSnapshot(snapshot, ids);
    } else {
      rejectTracksInSnapshot(snapshot, ids);
    }
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
        await postHunkResolve(taskId, hunkId, decision);
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[hunkId];
        return next;
      });
      if (decision === "reject") {
        await persistRejectTracks(ids.filter((id) => id !== hunkId));
      } else if (snapshotHasEngine(snapshotRef.current)) {
        await persistDocument({ force: true });
      }
      keyRef.current = "";
      seenRef.current = null;
      await reload({ fresh: true });
      const latest = snapshotRef.current;
      if (latest) {
        if (decision === "accept") {
          acceptTracksInSnapshot(latest, ids);
        } else {
          rejectTracksInSnapshot(latest, ids);
        }
      }
    } catch (err) {
      snapshotRef.current = before;
      pageSnapshotRef.current = before;
      setSnapshot(before);
      unfoldCards(ids);
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const decideTracked = async (revId: string, decision: "accept" | "reject") => {
    const current = snapshotRef.current;
    const row = current?.tracked?.find((item) => item.revId === revId);
    if (!row || actionBusy || !isOwnRevisionAuthor(row.author, current)) {
      return;
    }
    const before = current;
    const target = decision === "accept" ? "accepted" : "rejected";
    const ids = idsCoveredWithTrack(row, current.hunks ?? [], current.tracked ?? []);
    foldCards(ids);
    if (decision === "accept") {
      acceptTracksInSnapshot(current, ids);
    } else {
      rejectTracksInSnapshot(current, ids);
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const taskId = current.taskId;
      if (taskId) {
        for (const hunk of current.hunks ?? []) {
          if (ids.includes(hunk.hunkId) && hunk.status !== target) {
            await postHunkResolve(taskId, hunk.hunkId, decision);
          }
        }
      }
      if (decision === "reject") {
        await persistRejectTracks(ids.filter((id) => (current.tracked ?? []).some((item) => item.revId === id)));
      } else if (snapshotHasEngine(snapshotRef.current)) {
        await persistDocument({ force: true });
      }
    } catch (err) {
      snapshotRef.current = before;
      pageSnapshotRef.current = before;
      setSnapshot(before);
      unfoldCards(ids);
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const decideAll = async (decision: "accept" | "reject") => {
    const current = snapshotRef.current;
    const taskId = current?.taskId;
    const pendingHunks = (current?.hunks ?? []).filter((hunk) => hunk.status === "pending");
    const ownTracks = (current?.tracked ?? []).filter(
      (row) => isOwnRevisionAuthor(row.author, current) && row.disposition !== "accepted",
    );
    if (actionBusy || (pendingHunks.length === 0 && ownTracks.length === 0)) {
      return;
    }
    if (pendingHunks.length > 0 && !taskId && ownTracks.length === 0) {
      return;
    }
    const before = current;
    const ids = [
      ...pendingHunks.map((hunk) => hunk.hunkId),
      ...ownTracks.map((row) => row.revId),
    ];
    foldCards(ids);
    if (decision === "accept") {
      acceptTracksInSnapshot(current, ids);
    } else {
      rejectTracksInSnapshot(current, ids);
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (taskId) {
        for (const hunk of pendingHunks) {
          await postHunkResolve(taskId, hunk.hunkId, decision);
        }
      }
      if (decision === "reject") {
        await persistRejectTracks(ownTracks.map((row) => row.revId));
      } else if (snapshotHasEngine(snapshotRef.current)) {
        await persistDocument({ force: true });
      }
      keyRef.current = "";
      seenRef.current = null;
      await reload({ fresh: true });
      const latest = snapshotRef.current;
      if (latest) {
        if (decision === "accept") {
          acceptTracksInSnapshot(latest, ids);
        } else {
          rejectTracksInSnapshot(latest, ids);
        }
      }
    } catch (err) {
      if (before) {
        snapshotRef.current = before;
        pageSnapshotRef.current = before;
        setSnapshot(before);
      }
      unfoldCards(ids);
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
    if (!snapshot || actionBusy) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      if (snapshotHasEngine(snapshot) && dirtyPlainRef.current) {
        await persistDocument({ force: true });
      }
      const body = await apiSendJson<
        {
          ok: true;
          outputPath: string;
          outputFileName: string;
          degraded?: boolean;
          trackWarning?: string;
          mode?: string;
        },
        { taskId?: string; root: RootKey; path: string; projectDir?: string }
      >(apiBase, "/api/word-surface/export", "POST", {
        root,
        path: relPath,
        ...(snapshot.taskId ? { taskId: snapshot.taskId } : {}),
        ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
      });
      setExportPath(body.outputPath);
      setExportNote(
        body.mode === "copy"
          ? `已另存 ${body.outputFileName}，内容与正在打开的这份相同，修订仍留在文件里。`
          : body.trackWarning
            ? `已覆盖审阅稿 ${body.outputFileName}，但修订轨核对未通过：${body.trackWarning}只含已接受的修改。原件留在原地。`
            : body.degraded
              ? `已覆盖审阅稿 ${body.outputFileName}，修订痕迹没有完整落下。只含已接受的修改。原件留在原地。`
              : `已覆盖审阅稿 ${body.outputFileName}。只含已接受的修改。这一条已从在办拿掉。原件留在原地。`,
      );
    } catch (err) {
      setActionError(errorMessage(err, "导出失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const addCommentFromSelection = async () => {
    const ctx = engineContext(window.getSelection()?.anchorNode ?? null);
    const range = editorTextRange();
    const anchorText = (range?.toString() || window.getSelection()?.toString() || "").trim();
    if (ctx?.caret && ctx.caret.end > ctx.caret.start && snapshotHasEngine(ctx.current) && anchorText) {
      const commentId = String(
        Math.max(
          0,
          ...(ctx.current.docxComments ?? []).map((row) => Number(row.commentId) || 0),
        ) + 1,
      );
      const paragraphs = paragraphRunsOf(ctx.current);
      paragraphs[ctx.index] = commentOnRange(ctx.runs, ctx.caret, commentId);
      const comment = {
        commentId,
        author:
          ctx.current.revisionAuthor?.trim() ||
          ctx.current.lawyerDisplayName?.trim() ||
          "LawMind",
        body: "批注",
        anchorText,
        date: new Date().toISOString(),
      };
      snapshotRef.current = {
        ...ctx.current,
        docxComments: [...(ctx.current.docxComments ?? []), comment],
      };
      commitEngineRuns(paragraphs, { index: ctx.index, offset: ctx.caret.end });
      setSelectionMenu(null);
      return;
    }
    const taskId = snapshot?.taskId;
    if (!taskId || !anchorText || actionBusy) {
      setActionError(anchorText ? "请先在正文里改一处，形成修订任务后再加批注。" : "请先选中要批注的正文。");
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

  const engineMode = snapshotHasEngine(snapshot);
  const canExport = Boolean(snapshot) && !actionBusy;
  const serverHunks = snapshot?.hunks ?? [];
  const trackedAll = snapshot?.tracked ?? [];
  const trackedRows = trackedAll.filter((row) => {
    if (authorFilter !== "all" && row.author !== authorFilter) {
      return false;
    }
    return revisionCardStatus(row.revId, serverHunks, trackedAll) !== "rejected";
  });
  const railLive = engineMode
    ? []
    : liveEdits.filter(
        (edit) => !serverHunks.some((hunk) => hunk.before === edit.before && hunk.after === edit.after),
      );
  const railHunks = (engineMode ? serverHunks.filter((hunk) => !hunk.placed) : serverHunks).filter((hunk) => {
    if (railLive.some((edit) => edit.before === hunk.before)) {
      return false;
    }
    if (hunk.status === "rejected" || revisionCardStatus(hunk.hunkId, serverHunks, trackedAll) === "rejected") {
      return false;
    }
    return !trackedRows.some((row) => trackCoversHunk(row, hunk));
  });
  const pending =
    trackedRows.filter(
      (row) =>
        isOwnRevisionAuthor(row.author, snapshot) &&
        revisionCardStatus(row.revId, serverHunks, trackedAll) === "pending",
    ).length +
    railHunks.filter(
      (hunk) => revisionCardStatus(hunk.hunkId, serverHunks, trackedAll) === "pending",
    ).length;
  const foreignCount = trackedRows.filter((row) => !isOwnRevisionAuthor(row.author, snapshot)).length;
  const lawyerName = snapshot?.lawyerDisplayName?.trim() || "律师";
  const hiddenAuthors =
    authorFilter === "all" ? undefined : new Set((snapshot?.authors ?? []).filter((name) => name !== authorFilter));
  const railComments: SurfaceComment[] = [
    ...(snapshot?.docxComments ?? []).map((row) => ({
      commentId: row.commentId,
      taskId: snapshot?.taskId ?? "",
      anchorText: row.anchorText,
      body: row.body,
      author: row.author,
      createdAt: row.date ?? "",
    })),
    ...comments.filter(
      (row) => !(snapshot?.docxComments ?? []).some((docx) => docx.commentId === row.commentId),
    ),
  ];
  const pageSnapshotRef = useRef<WordSurfaceSnapshot | null>(snapshot);
  if (!dirtyPlainRef.current || engineMode) {
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
      hiddenAuthors,
    }),
    [drafts, focusHunk, hiddenAuthors, markup, onPlainFocus, scheduleSync, selectedId, showAllMarkup, snapshot?.hunks],
  );
  if (
    engineMode ||
    !dirtyPlainRef.current ||
    !pagePaintRef.current ||
    pagePaintRef.current.markup !== pagePaintLive.markup
  ) {
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
                ? foreignCount > 0
                  ? `核对 · ${pending} 处待定，另有 ${foreignCount} 处他人修订`
                  : `核对 · ${pending} 处待定`
                : trackedRows.length > 0
                  ? `已标出 · ${trackedRows.length} 处`
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
          {(snapshot?.authors?.length ?? 0) > 0 ? (
            <label className="lm-word-markup">
              <select
                className="lm-input lm-word-markup-select"
                aria-label="特定人员"
                data-testid="lm-word-author-filter"
                value={authorFilter}
                onChange={(event) => setAuthorFilter(event.target.value)}
              >
                <option value="all">所有审阅者</option>
                {(snapshot?.authors ?? []).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-word-prev"
            disabled={!snapshot || (snapshot.hunks.length === 0 && trackedRows.length === 0)}
            onClick={() => stepRevision(-1)}
          >
            上一条
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            data-testid="lm-word-next"
            disabled={!snapshot || (snapshot.hunks.length === 0 && trackedRows.length === 0)}
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
            title="另存一份当前打开的文件，修订仍留在拷贝里。"
            onClick={() => void exportWord()}
          >
            另存审阅稿
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
      <div className="lm-word-surface-sheet">
      <WordSurfaceDocument
        key={pageEpoch}
        fileName={fileName}
        loadError={loadError}
        snapshot={pageSnapshotRef.current}
        paint={pagePaintRef.current}
      />
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
          <div className="lm-word-surface-rail-margin">
          {railLive.length === 0 && railHunks.length === 0 && trackedRows.length === 0 && railComments.length === 0 ? (
            <p className="lm-word-surface-empty">
              右侧是这份文件里的修订。接受后折叠，导出仍带痕迹；拒绝后从正文和导出拿掉。他人修订只显示。
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
            <div className="lm-word-rev-spacer" aria-hidden="true" />
            {trackedRows.map((row) => {
              const own = isOwnRevisionAuthor(row.author, snapshot);
              const shownStatus = revisionCardStatus(row.revId, serverHunks, trackedAll);
              const reviewed = shownStatus === "accepted";
              const open = own ? (openIds[row.revId] ?? !reviewed) :  openIds[row.revId];
              return (
                <TrackBalloon
                  key={`track-${row.revId}-${row.change}`}
                  row={row}
                  own={own}
                  accepted={reviewed}
                  open={open}
                  selected={selectedId === row.revId}
                  busy={actionBusy}
                  onFocus={() => focusHunk(row.revId, "page")}
                  onFold={() => setOpenIds((current) => ({ ...current, [row.revId]: false }))}
                  onUnfold={() => focusHunk(row.revId, "page")}
                  onAccept={() => void decideTracked(row.revId, "accept")}
                  onReject={() => void decideTracked(row.revId, "reject")}
                />
              );
            })}
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
              if (afterText === hunk.before && !(hunk.rationale ?? "").startsWith("设置格式")) {
                return null;
              }
              const reviewed = hunk.status !== "pending";
              const open = openIds[hunk.hunkId] ?? !reviewed;
              return (
                <HunkBalloon
                  key={hunk.hunkId}
                  hunk={{ ...hunk, color: hunk.color ?? revisionColor(serverHunks, hunk.hunkId) }}
                  afterText={afterText}
                  open={open}
                  selected={selectedId === hunk.hunkId}
                  busy={actionBusy}
                  onFocus={() => focusHunk(hunk.hunkId, "page")}
                  onFold={() => setOpenIds((current) => ({ ...current, [hunk.hunkId]: false }))}
                  onUnfold={() => {
                    setOpenIds((current) => ({ ...current, [hunk.hunkId]: true }));
                    focusHunk(hunk.hunkId, "page");
                  }}
                  onAccept={() => void decide(hunk.hunkId, "accept")}
                  onReject={() => void decide(hunk.hunkId, "reject")}
                  onDraft={(text, changeIndex) => {
                    const next = replaceChangeAfter(hunk.before, afterText, changeIndex, text);
                    draftsRef.current = { ...draftsRef.current, [hunk.hunkId]: next };
                    setSelectedId(hunk.hunkId);
                    setDrafts(draftsRef.current);
                  }}
                  onCommit={() => void commitRailEdit(hunk.hunkId)}
                />
              );
            })}
            {railComments.map((comment) => (
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
    </div>
  );
}

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
