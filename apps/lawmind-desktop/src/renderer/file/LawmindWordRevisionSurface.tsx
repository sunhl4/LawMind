/**
 * Open .docx in the chat middle column as a text preview. Dialogue revisions
 * paint onto the file's paragraphs. Accepted hunks can be exported beside the
 * original; this page is not the final Word.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WordSurfaceSnapshot } from "../../../../../src/lawmind/drafts/word-surface.ts";
import { apiGetJson, apiSendJson, errorMessage } from "../api-client";

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
    paragraphs: snap.paragraphs,
    hunks: snap.hunks.map((hunk) => [hunk.hunkId, hunk.status, hunk.before, hunk.after, hunk.placed]),
  });
}

export function LawmindWordRevisionSurface(props: LawmindWordRevisionSurfaceProps): ReactNode {
  const { apiBase, projectDir, root, relPath, fileName, busy = false, onOpenWithSystem, onRevealSource } =
    props;
  const [snapshot, setSnapshot] = useState<WordSurfaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ hunkId: string; text: string } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const keyRef = useRef("");
  const seenRef = useRef<{ fileMtimeMs: number; proposalAt: string; codeStamp: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const reload = useCallback(async () => {
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份 Word。");
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
      const nextKey = snapshotKey(body);
      if (nextKey !== keyRef.current) {
        keyRef.current = nextKey;
        setSnapshot(body);
        seenRef.current = {
          fileMtimeMs: body.fileMtimeMs ?? 0,
          proposalAt: body.proposalUpdatedAt ?? "",
          codeStamp: body.codeStamp ?? "",
        };
        setEditing((current) => {
          if (!current) {
            return null;
          }
          const hunk = body.hunks.find((row) => row.hunkId === current.hunkId);
          return hunk?.status === "pending" ? current : null;
        });
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
    setEditing(null);
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

  const decide = async (hunkId: string, decision: "accept" | "reject") => {
    const taskId = snapshot?.taskId;
    if (!taskId || actionBusy) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}/redline/hunks/${encodeURIComponent(hunkId)}/resolve`,
        "POST",
        { decision },
      );
      keyRef.current = "";
      seenRef.current = null;
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, decision === "accept" ? "接受失败。" : "拒绝失败。"));
    } finally {
      setActionBusy(false);
    }
  };

  const saveEdit = async () => {
    const taskId = snapshot?.taskId;
    if (!taskId || !editing || actionBusy) {
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await apiSendJson(
        apiBase,
        `/api/word-surface/hunks/${encodeURIComponent(editing.hunkId)}/revise`,
        "POST",
        { taskId, after: editing.text },
      );
      setEditing(null);
      keyRef.current = "";
      seenRef.current = null;
      await reload();
    } catch (err) {
      setActionError(errorMessage(err, "没能保存这条修改。"));
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
          ? `已写出预览稿 ${body.outputFileName}，修订痕迹没有完整落下。只含已接受的修改。原件未改。这不是终稿。`
          : `已写出预览稿 ${body.outputFileName}：只含已接受的修改。没决定的没有写入。原件未改。这不是终稿。`,
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
      <header className="lm-word-surface-bar">
        <div className="lm-word-surface-title">
          <span className="lm-word-surface-name">{fileName}</span>
          <span className="lm-word-surface-count">
            {snapshot
              ? pending > 0
                ? `预览 · ${pending} 处待定`
                : "预览 · 没有待定修订"
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
            onClick={onOpenWithSystem}
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
                ? "只把已接受的修改写入旁边那份稿。原件不动。这是预览，不是终稿。"
                : "先接受要留下的修改。没决定的不会写入。这是预览，不是终稿。"
            }
            onClick={() => void exportWord()}
          >
            导出
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
        <article className="lm-word-surface-page lm-scroll" aria-label={fileName}>
          {loadError && !snapshot ? (
            <p className="lm-word-surface-empty">{loadError}</p>
          ) : snapshot &&
            snapshot.paragraphs.every((paragraph) =>
              paragraph.segments.every((segment) => segment.kind === "text" && !segment.text.trim()),
            ) ? (
            <p className="lm-word-surface-empty">这份 Word 没有可抽出的正文。</p>
          ) : (
            snapshot?.paragraphs.map((paragraph, index) => (
              <p key={index} className="lm-word-surface-p">
                {paragraph.segments.map((segment, segIndex) =>
                  segment.kind === "text" ? (
                    <span key={segIndex}>{segment.text}</span>
                  ) : (
                    <span
                      key={segIndex}
                      className={`lm-word-rev${selectedId === segment.hunkId ? " lm-word-rev-active" : ""}`}
                      data-word-hunk={segment.hunkId}
                      data-word-slot="page"
                      onClick={() => focusHunk(segment.hunkId, "rail")}
                    >
                      {segment.before ? <del className="lm-word-rev-del">{segment.before}</del> : null}
                      {segment.after ? <ins className="lm-word-rev-ins">{segment.after}</ins> : null}
                    </span>
                  ),
                )}
              </p>
            ))
          )}
        </article>
        <aside className="lm-word-surface-rail lm-scroll" aria-label="修订">
          <h2 className="lm-word-surface-rail-title">修订</h2>
          {!snapshot || snapshot.hunks.length === 0 ? (
            <p className="lm-word-surface-empty">
              这是正文预览，不是 Word 里的修订。对话里的修改会出现在这里。接受之后才能导出旁边的稿；没决定的不会写入。原件不动。
            </p>
          ) : (
            snapshot.hunks.map((hunk) => {
              const pendingHunk = hunk.status === "pending";
              const editingThis = editing?.hunkId === hunk.hunkId;
              return (
                <section
                  key={hunk.hunkId}
                  className={`lm-word-rev-card${selectedId === hunk.hunkId ? " lm-word-rev-card-active" : ""}`}
                  data-word-hunk={hunk.hunkId}
                  data-word-slot="rail"
                  data-testid={`lm-word-hunk-${hunk.hunkId}`}
                >
                  <header className="lm-word-rev-card-head">
                    <span>{hunk.sectionHeading || "正文"}</span>
                    <span className="lm-word-rev-status">
                      {hunk.status === "pending" ? "待定" : hunk.status === "accepted" ? "已接受" : "已拒绝"}
                    </span>
                  </header>
                  {hunk.rationale ? <p className="lm-word-rev-why">{hunk.rationale}</p> : null}
                  {editingThis ? (
                    <textarea
                      className="lm-input lm-word-rev-edit"
                      aria-label="修改这条修订"
                      value={editing.text}
                      onChange={(e) => setEditing({ hunkId: hunk.hunkId, text: e.target.value })}
                    />
                  ) : (
                    <p className="lm-word-rev-preview">
                      {hunk.before ? <del className="lm-word-rev-del">{hunk.before}</del> : null}
                      {hunk.after ? <ins className="lm-word-rev-ins">{hunk.after}</ins> : <span>删除</span>}
                    </p>
                  )}
                  {!hunk.placed && pendingHunk ? (
                    <p className="lm-word-rev-unplaced">没能贴进正文，仍可在这里决定。</p>
                  ) : null}
                  {pendingHunk ? (
                    <div className="lm-word-rev-card-actions">
                      {editingThis ? (
                        <>
                          <button
                            type="button"
                            className="lm-btn lm-btn-sm"
                            disabled={actionBusy}
                            onClick={() => void saveEdit()}
                          >
                            保存修改
                          </button>
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            disabled={actionBusy}
                            onClick={() => setEditing(null)}
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="lm-btn lm-btn-sm"
                            data-testid={`lm-word-accept-${hunk.hunkId}`}
                            disabled={actionBusy}
                            onClick={() => void decide(hunk.hunkId, "accept")}
                          >
                            接受
                          </button>
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            disabled={actionBusy}
                            onClick={() => void decide(hunk.hunkId, "reject")}
                          >
                            拒绝
                          </button>
                          <button
                            type="button"
                            className="lm-btn lm-btn-ghost lm-btn-sm"
                            disabled={actionBusy}
                            onClick={() => {
                              setSelectedId(hunk.hunkId);
                              setEditing({ hunkId: hunk.hunkId, text: hunk.after });
                            }}
                          >
                            手改
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })
          )}
        </aside>
      </div>
    </div>
  );
}
