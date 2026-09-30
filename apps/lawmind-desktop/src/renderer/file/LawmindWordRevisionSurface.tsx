/**
 * Open .docx in the chat middle column as a text preview. Dialogue revisions
 * paint onto the file's paragraphs. Accepted hunks can be exported beside the
 * original; this page is not the final Word.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  replaceSingleChange,
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

const POLL_MS = 4_000;

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
  const [actionBusy, setActionBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenu | null>(null);
  const keyRef = useRef("");
  const reboundRef = useRef("");
  const seenRef = useRef<{ fileMtimeMs: number; proposalAt: string; codeStamp: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editingPlainRef = useRef(false);
  const { width: railWidth, onResizePointerDown: onRailResize } = usePaneResizePx({
    storageKey: "lawmind.ui.wordSurfaceRailWidth",
    defaultWidth: 220,
    min: 180,
    max: 480,
    edge: "trailing",
  });

  const reload = useCallback(async () => {
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份 Word。");
      return;
    }
    if (editingPlainRef.current) {
      return;
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
        return;
      }
      if ((body.hunks?.length ?? 0) === 0 && !body.taskId && reboundRef.current !== relPath) {
        reboundRef.current = relPath;
        void openBoundBaselineIfDifferent({ apiBase, relPath });
      }
      const nextKey = snapshotKey(body);
      if (nextKey !== keyRef.current) {
        keyRef.current = nextKey;
        setSnapshot(body);
        seenRef.current = {
          fileMtimeMs: body.fileMtimeMs ?? 0,
          proposalAt: body.proposalUpdatedAt ?? "",
          codeStamp: body.codeStamp ?? "",
        };
        setDrafts((current) => dropSettledDrafts(current, body.hunks));
      } else {
        seenRef.current = {
          fileMtimeMs: body.fileMtimeMs ?? seenRef.current?.fileMtimeMs ?? 0,
          proposalAt: body.proposalUpdatedAt ?? "",
          codeStamp: body.codeStamp ?? seenRef.current?.codeStamp ?? "",
        };
      }
      setLoadError(null);
    } catch (err) {
      if (!keyRef.current) {
        setLoadError(errorMessage(err, "读不到这份 Word。"));
      }
    }
  }, [apiBase, projectDir, relPath, root]);

  useEffect(() => {
    keyRef.current = "";
    seenRef.current = null;
    setSnapshot(null);
    setExportNote(null);
    setExportPath(null);
    setDrafts({});
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

  const focusHunk = (hunkId: string, slot: "page" | "rail") => {
    setSelectedId(hunkId);
    const node = rootRef.current?.querySelector(
      `[data-word-hunk="${CSS.escape(hunkId)}"][data-word-slot="${slot}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  };

  const replacementText = (hunkId: string, after: string) => drafts[hunkId] ?? after;

  const syncDocument = useCallback(async () => {
    const page = rootRef.current?.querySelector(".lm-word-surface-page");
    if (!apiBase.trim() || !page || actionBusy) {
      return;
    }
    const paragraphs = [...page.querySelectorAll<HTMLElement>("[data-baseline]")].map((node) => ({
      baseline: node.dataset.baseline ?? "",
      current: visibleResultText(node),
    }));
    setActionBusy(true);
    setActionError(null);
    editingPlainRef.current = false;
    try {
      await apiSendJson(apiBase, "/api/word-surface/sync", "POST", {
        root,
        path: relPath,
        paragraphs,
        ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
      });
      keyRef.current = "";
      seenRef.current = null;
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, "没能按原文更新修订。"));
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, apiBase, projectDir, relPath, reload, root]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const rootNode = rootRef.current;
      if (!rootNode || !(event.target instanceof Node) || !rootNode.contains(event.target)) {
        return;
      }
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z" && !event.altKey) {
        event.preventDefault();
        document.execCommand(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (key !== "s" || event.altKey || event.shiftKey || (!event.ctrlKey && !event.metaKey)) {
        return;
      }
      event.preventDefault();
      void syncDocument();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [syncDocument]);

  const showSelectionMenu = (clientX?: number, clientY?: number) => {
    const range = editorTextRange();
    if (!range) {
      setSelectionMenu(null);
      return;
    }
    const rect = range.getBoundingClientRect();
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
    const del = document.createElement("del");
    del.className = "lm-word-rev-del";
    try {
      range.surroundContents(del);
    } catch {
      del.appendChild(range.extractContents());
      range.insertNode(del);
    }
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    void syncDocument();
  };

  const unstrikeSelection = () => {
    const range = editorTextRange();
    const anchor = range?.commonAncestorContainer;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const del = el?.closest("del");
    if (!del?.parentNode) {
      return;
    }
    const parent = del.parentNode;
    while (del.firstChild) {
      parent.insertBefore(del.firstChild, del);
    }
    parent.removeChild(del);
    window.getSelection()?.removeAllRanges();
    setSelectionMenu(null);
    void syncDocument();
  };

  const decide = async (hunkId: string, decision: "accept" | "reject") => {
    const taskId = snapshot?.taskId;
    const hunk = snapshot?.hunks.find((row) => row.hunkId === hunkId);
    if (!taskId || !hunk || actionBusy) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const after = replacementText(hunkId, hunk.after);
      const target = decision === "accept" ? "accepted" : "rejected";
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
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
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
        { ok: true; outputPath: string; outputFileName: string; degraded?: boolean },
        { taskId: string; projectDir?: string }
      >(apiBase, "/api/word-surface/export", "POST", {
        taskId,
        ...(projectDir?.trim() ? { projectDir: projectDir.trim() } : {}),
      });
      setExportPath(body.outputPath);
      setExportNote(
        body.degraded
          ? `已覆盖审阅稿 ${body.outputFileName}，修订痕迹没有完整落下。只含已接受的修改。原件留在原地。`
          : `已覆盖审阅稿 ${body.outputFileName}。只含已接受的修改。这一条已从在办拿掉。原件留在原地。`,
      );
    } catch (err) {
      setActionError(errorMessage(err, "导出失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const pending = snapshot?.summary.pending ?? 0;
  const accepted = snapshot?.summary.accepted ?? 0;
  const canExport = accepted > 0 && !actionBusy;

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
      <article
        className="lm-word-surface-page"
        style={pageStyle(snapshot?.page)}
        aria-label={fileName}
      >
          {loadError && !snapshot ? (
            <p className="lm-word-surface-empty">{loadError}</p>
          ) : snapshot &&
            snapshot.paragraphs.every((paragraph) =>
              paragraph.segments.every((segment) => segment.kind === "text" && !segment.text.trim()),
            ) ? (
            <p className="lm-word-surface-empty">这份 Word 没有可抽出的正文。</p>
          ) : (
            renderSurfaceBlocks(
              snapshot?.blocks?.length
                ? snapshot.blocks
                : (snapshot?.paragraphs ?? []).map((paragraph) => ({ kind: "paragraph" as const, ...paragraph })),
              {
                hunks: snapshot?.hunks ?? [],
                selectedId,
                drafts,
                onFocus: focusHunk,
                onPlainFocus: (active) => {
                  editingPlainRef.current = active;
                },
              },
              snapshot?.page,
            )
          )}
      </article>
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
        className="lm-word-surface-rail lm-scroll"
        aria-label="修订"
        style={{ width: railWidth, flexBasis: railWidth }}
      >
          <h2 className="lm-word-surface-rail-title">修订</h2>
          {!snapshot || snapshot.hunks.length === 0 ? (
            <p className="lm-word-surface-empty">
              右侧是待核对的修订。接受要留下的，再导出覆盖旁边的审阅稿。没决定的不会写入。原件留在原地。
            </p>
          ) : (
            snapshot.hunks.map((hunk) => {
              const afterText = liveAfter(drafts, hunk.hunkId, hunk.after);
              const reviewed = hunk.status !== "pending";
              const open = !reviewed ||  openIds[hunk.hunkId];
              const foldLabel = hunk.status === "accepted" ? "已接受" : hunk.status === "rejected" ? "已拒绝" : "待定";
              return (
                <section
                  key={hunk.hunkId}
                  className={`lm-word-rev-card${selectedId === hunk.hunkId ? " lm-word-rev-card-active" : ""}${reviewed && !open ? " lm-word-rev-card-done" : ""}`}
                  data-word-hunk={hunk.hunkId}
                  data-word-slot="rail"
                  data-rev-color={String(hunk.color ?? revisionColor(snapshot.hunks, hunk.hunkId))}
                  data-testid={`lm-word-hunk-${hunk.hunkId}`}
                  onClick={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("button, textarea, a")) {
                      return;
                    }
                    focusHunk(hunk.hunkId, "page");
                  }}
                >
                  {open ? (
                    <>
                      <header className="lm-word-rev-card-head">
                        <span>{hunk.sectionHeading || "正文"}</span>
                        {reviewed ? (
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            onClick={() => setOpenIds((current) => ({ ...current, [hunk.hunkId]: false }))}
                          >
                            收起
                          </button>
                        ) : (
                          <span className="lm-word-rev-status">{foldLabel}</span>
                        )}
                      </header>
                      {hunk.rationale ? <p className="lm-word-rev-why">{hunk.rationale}</p> : null}
                      <p className="lm-word-rev-preview">
                        {revisionPieces(hunk.before, afterText).map((piece, pieceIndex) =>
                          piece.kind === "text" ? (
                            <span key={pieceIndex}>{piece.text}</span>
                          ) : (
                            <span key={pieceIndex}>
                              {piece.before ? <del className="lm-word-rev-del">{piece.before}</del> : null}
                              {piece.after ? <ins className="lm-word-rev-ins">{piece.after}</ins> : null}
                            </span>
                          ),
                        )}
                      </p>
                      <label className="lm-word-rev-edit-label">
                        {singleChangeLabel(hunk.before, afterText)}
                        <textarea
                          className="lm-input lm-word-rev-edit"
                          aria-label="修改这条修订"
                          value={singleChangeValue(hunk.before, afterText)}
                          onFocus={() => focusHunk(hunk.hunkId, "page")}
                          onChange={(event) => {
                            const text = event.target.value;
                            setSelectedId(hunk.hunkId);
                            setDrafts((current) => ({
                              ...current,
                              [hunk.hunkId]: replaceSingleChange(hunk.before, afterText, text),
                            }));
                          }}
                        />
                      </label>
                      {!hunk.placed ? <p className="lm-word-rev-unplaced">没能贴进正文，仍可在这里决定。</p> : null}
                      <div className="lm-word-rev-card-actions">
                        <button
                          type="button"
                          className="lm-btn lm-btn-sm lm-word-rev-icon"
                          data-testid={`lm-word-accept-${hunk.hunkId}`}
                          aria-label="接受"
                          aria-pressed={hunk.status === "accepted"}
                          disabled={actionBusy}
                          onClick={() => void decide(hunk.hunkId, "accept")}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="lm-btn lm-btn-ghost lm-btn-sm lm-word-rev-icon"
                          data-testid={`lm-word-reject-${hunk.hunkId}`}
                          aria-label="拒绝"
                          aria-pressed={hunk.status === "rejected"}
                          disabled={actionBusy}
                          onClick={() => void decide(hunk.hunkId, "reject")}
                        >
                          ✕
                        </button>
                      </div>
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
                        {hunk.status === "accepted" ? "✓" : "✕"}
                      </span>
                      <span className="lm-word-rev-fold-text">
                        {foldLabel} · {(hunk.before || hunk.after).replace(/\s+/g, " ").trim()}
                      </span>
                    </button>
                  )}
                </section>
              );
            })
          )}
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
            <button type="button" role="menuitem" onClick={unstrikeSelection}>
              取消删除线
            </button>
          ) : (
            <button type="button" role="menuitem" onClick={strikeSelection}>
              删除线
            </button>
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
};

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
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} colSpan={cell.colspan} style={cellStyle(cell)}>
                  {renderSurfaceBlocks(cell.blocks, paint, page)}
                </td>
              ))}
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

function visibleResultText(editor: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node instanceof HTMLElement && node.tagName === "DEL") {
      return;
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

function singleChange(before: string, after: string): { before: string; after: string } | null {
  const changes = revisionPieces(before, after).filter((piece) => piece.kind === "change");
  return changes.length === 1 && changes[0]?.kind === "change" ? changes[0] : null;
}

function singleChangeValue(before: string, after: string): string {
  return singleChange(before, after)?.after ?? after;
}

function singleChangeLabel(before: string, after: string): string {
  const change = singleChange(before, after);
  if (!change) {
    return "改成";
  }
  return change.before ? "改成" : "插入";
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
  return (
    <span
      key={segIndex}
      className={`lm-word-rev${paint.selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
      style={markStyle(segment, true)}
      data-word-hunk={segment.hunkId}
      data-word-slot="page"
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
  return (
    <p
      key={index}
      className={`lm-word-surface-p${blank ? " lm-word-surface-blank" : ""}`}
      style={paragraphStyle(paragraph)}
    >
      {paragraph.listLabel ? <span className="lm-word-surface-label">{paragraph.listLabel}</span> : null}
      <span
        className="lm-word-surface-plain"
        data-baseline={paragraphBaseline(paragraph)}
        contentEditable={paragraphBaseline(paragraph).trim().length > 0}
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-label="修改这段正文"
        onFocus={() => paint.onPlainFocus(true)}
        onBlur={() => paint.onPlainFocus(false)}
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
