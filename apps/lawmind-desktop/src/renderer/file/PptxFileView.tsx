import type { AnyFileRoot } from "./file-workbench-types";
/**
 * Middle-column PowerPoint surface — WPS-like slide canvas via officecli screenshots,
 * plus simple shape-text editing (save writes back through /api/fs/pptx-save).
 * Falls back to text extract when visual render is unavailable.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  apiGetJson,
  apiSendJson,
  errorMessage,
  fetchApi,
  fetchWithLoopbackAuthRetry,
} from "../api-client";
import type { OpenFileTab } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type PptxTextBlock = {
  role: "title" | "subtitle" | "body" | "notes";
  text: string;
};

export type PptxEditableShape = {
  path: string;
  slideIndex: number;
  text: string;
  isTitle: boolean;
  name?: string;
};

export type PptxVisualSlide = {
  index: number;
  label: string;
  title: string;
  shapes: PptxEditableShape[];
};

export type PptxTextSlide = {
  index: number;
  label: string;
  blocks: PptxTextBlock[];
  truncated: boolean;
};

export type PptxPreviewResponse =
  | {
      ok: true;
      mode: "visual";
      slideCount: number;
      truncatedSlides: boolean;
      slides: PptxVisualSlide[];
      cacheKey: string;
      mtimeMs: number;
    }
  | {
      ok: true;
      mode: "text";
      slideCount: number;
      truncatedSlides: boolean;
      slides: PptxTextSlide[];
      mtimeMs: number;
    };

export type PptxFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

function conflictMtimeFromError(err: unknown): number | null {
  if (!err || typeof err !== "object") {
    return null;
  }
  const rec = err as { status?: unknown; body?: { mtimeMs?: unknown } | null };
  if (rec.status !== 409) {
    return null;
  }
  const mtime = Number(rec.body?.mtimeMs);
  return Number.isFinite(mtime) ? mtime : null;
}

function slideImageUrl(
  apiBase: string,
  root: AnyFileRoot,
  relPath: string,
  page1Based: number,
): string {
  const q = new URLSearchParams({
    root,
    path: relPath,
    page: String(page1Based),
  });
  return `${apiBase.replace(/\/$/, "")}/api/fs/pptx-slide?${q.toString()}`;
}

async function loadSlideBlob(
  apiBase: string,
  root: AnyFileRoot,
  relPath: string,
  page1Based: number,
): Promise<string> {
  const { response } = await fetchWithLoopbackAuthRetry(apiBase, (base) =>
    fetchApi(slideImageUrl(base, root, relPath, page1Based), {}, {
      tag: "pptxSlide",
      timeoutMs: 180_000,
    }),
  );
  if (!response.ok) {
    throw new Error(`幻灯片渲染失败（${response.status}）。`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function PptxFileView(props: PptxFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [mode, setMode] = useState<"visual" | "text" | null>(null);
  const [visualSlides, setVisualSlides] = useState<PptxVisualSlide[]>([]);
  const [textSlides, setTextSlides] = useState<PptxTextSlide[]>([]);
  const [truncatedSlides, setTruncatedSlides] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [fileMtimeMs, setFileMtimeMs] = useState(tab.mtimeMs);
  const [slideBlobUrl, setSlideBlobUrl] = useState<string | null>(null);
  const [slideBusy, setSlideBusy] = useState(false);
  const [edits, setEdits] = useState<Map<string, string>>(() => new Map());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const requestKey = useMemo(
    () => `${apiBase}|${tab.root}|${tab.path}|${tab.mtimeMs}`,
    [apiBase, tab.root, tab.path, tab.mtimeMs],
  );

  const reload = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    setSaveError(null);
    setEdits(new Map());
    setSelectedPath(null);
    setMode(null);
    setVisualSlides([]);
    setTextSlides([]);
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份演示文稿。");
      setBusy(false);
      return;
    }
    try {
      const q = new URLSearchParams({ root: tab.root, path: tab.path });
      const body = await apiGetJson<PptxPreviewResponse>(
        apiBase,
        `/api/fs/pptx-preview?${q.toString()}`,
      );
      setFileMtimeMs(body.mtimeMs);
      setTruncatedSlides(body.truncatedSlides);
      setActiveIndex(0);
      if (body.mode === "visual") {
        setMode("visual");
        setVisualSlides(body.slides);
      } else {
        setMode("text");
        setTextSlides(body.slides);
      }
    } catch (err) {
      setLoadError(errorMessage(err, "读不到这份演示文稿。"));
    } finally {
      setBusy(false);
    }
  }, [apiBase, tab.root, tab.path]);

  useEffect(() => {
    void reload();
  }, [requestKey, reload]);

  useEffect(() => {
    if (mode !== "visual" || !apiBase.trim()) {
      setSlideBlobUrl(null);
      return undefined;
    }
    let revoked: string | null = null;
    let cancelled = false;
    setSlideBusy(true);
    void (async () => {
      try {
        const url = await loadSlideBlob(apiBase, tab.root, tab.path, activeIndex + 1);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoked = url;
        setSlideBlobUrl(url);
      } catch (err) {
        if (!cancelled) {
          setSlideBlobUrl(null);
          setSaveError(errorMessage(err, "幻灯片画面渲染失败。"));
        }
      } finally {
        if (!cancelled) {
          setSlideBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [mode, apiBase, tab.root, tab.path, activeIndex, fileMtimeMs]);

  const dirty = edits.size > 0;
  const activeVisual = visualSlides[activeIndex] ?? null;
  const activeText = textSlides[activeIndex] ?? null;
  const slideCount =
    mode === "visual" ? visualSlides.length : mode === "text" ? textSlides.length : 0;
  const canPrev = activeIndex > 0;
  const canNext = activeIndex + 1 < slideCount;

  const selectedShape =
    activeVisual?.shapes.find((s) => s.path === selectedPath) ??
    activeVisual?.shapes[0] ??
    null;
  const draftText =
    selectedShape != null
      ? (edits.has(selectedShape.path)
          ? (edits.get(selectedShape.path) ?? "")
          : selectedShape.text)
      : "";

  const saveEdits = useCallback(async () => {
    if (!dirty || saving || mode !== "visual") {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = [...edits.entries()].map(([shapePath, text]) => ({
        path: shapePath,
        text,
      }));
      const result = await apiSendJson<{ ok: true; mtimeMs: number; applied: number }>(
        apiBase,
        "/api/fs/pptx-save",
        "POST",
        {
          root: tab.root,
          path: tab.path,
          expectedMtimeMs: fileMtimeMs,
          edits: payload,
        },
      );
      setFileMtimeMs(result.mtimeMs);
      setEdits(new Map());
      // Refresh meta + force screenshot cache miss via mtime.
      await reload();
    } catch (err) {
      const conflict = conflictMtimeFromError(err);
      if (conflict != null) {
        setFileMtimeMs(conflict);
        setSaveError("文件已在外部改过，请重新打开后再保存。");
      } else {
        setSaveError(errorMessage(err, "保存失败。"));
      }
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, mode, edits, apiBase, tab.root, tab.path, fileMtimeMs, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        if (dirty) {
          e.preventDefault();
          e.stopPropagation();
          void saveEdits();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dirty, saveEdits]);

  return (
    <div className="lm-editor-pane lm-pptx-preview-pane" data-testid="lm-preview-pptx">
      <div className="lm-editor-header">
        <div className="lm-pptx-edit-status">
          {mode === "visual" ? <span className="lm-meta">幻灯片预览</span> : null}
          {mode === "text" ? <span className="lm-meta">文字预览（降级）</span> : null}
          {dirty ? <span className="lm-dot lm-dot-warn">未保存</span> : null}
          {saveError ? (
            <span className="lm-meta" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
        <div className="lm-editor-actions lm-pptx-preview-tools">
          {slideCount > 0 ? (
            <div className="lm-pptx-nav" aria-label="幻灯片翻页">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={!canPrev || busy}
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              >
                上一页
              </button>
              <span className="lm-meta lm-pptx-page-indicator" data-testid="lm-pptx-page">
                {activeIndex + 1} / {slideCount}
              </span>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={!canNext || busy}
                onClick={() => setActiveIndex((i) => Math.min(slideCount - 1, i + 1))}
              >
                下一页
              </button>
            </div>
          ) : null}
          {mode === "visual" ? (
            <button
              type="button"
              className="lm-btn lm-btn-sm"
              data-testid="lm-pptx-save"
              disabled={!dirty || saving}
              title="保存文字修改（⌘S）"
              onClick={() => void saveEdits()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          ) : null}
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      {loadError ? (
        <div className="lm-office-doc-body">
          <p className="lm-office-doc-title">{tab.name}</p>
          <p className="lm-office-doc-copy" role="alert">
            {loadError}
          </p>
        </div>
      ) : busy ? (
        <div className="lm-office-doc-body">
          <p className="lm-meta">正在打开演示文稿…</p>
        </div>
      ) : mode === "visual" ? (
        <div className="lm-pptx-preview-body lm-pptx-preview-body--visual">
          <aside className="lm-pptx-rail lm-scroll" aria-label="幻灯片目录">
            <ol className="lm-pptx-rail-list">
              {visualSlides.map((slide, index) => {
                const selected = index === activeIndex;
                return (
                  <li key={slide.index}>
                    <button
                      type="button"
                      className="lm-pptx-rail-item"
                      data-selected={selected ? "1" : "0"}
                      aria-current={selected ? "true" : undefined}
                      onClick={() => {
                        setActiveIndex(index);
                        setSelectedPath(null);
                      }}
                    >
                      <span className="lm-pptx-rail-num">{slide.label}</span>
                      <span className="lm-pptx-rail-title">{slide.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
          <section className="lm-pptx-stage lm-scroll" aria-label={`第 ${activeIndex + 1} 页`}>
            <div className="lm-pptx-canvas-wrap" data-testid="lm-pptx-canvas">
              {slideBusy && !slideBlobUrl ? (
                <p className="lm-meta">正在渲染幻灯片…</p>
              ) : slideBlobUrl ? (
                <img
                  className="lm-pptx-canvas-img"
                  src={slideBlobUrl}
                  alt={`第 ${activeIndex + 1} 页`}
                />
              ) : (
                <p className="lm-meta">暂无幻灯片画面。</p>
              )}
            </div>
            {truncatedSlides ? (
              <p className="lm-meta lm-pptx-preview-note">幻灯片过多，已截断显示前面部分。</p>
            ) : null}
          </section>
          <aside className="lm-pptx-edit-pane lm-scroll" aria-label="文字编辑">
            <p className="lm-pptx-edit-heading">本页文字</p>
            <ul className="lm-pptx-shape-list">
              {(activeVisual?.shapes ?? []).map((shape) => {
                const selected = (selectedPath ?? activeVisual?.shapes[0]?.path) === shape.path;
                const dirtyShape = edits.has(shape.path);
                return (
                  <li key={shape.path}>
                    <button
                      type="button"
                      className="lm-pptx-shape-item"
                      data-selected={selected ? "1" : "0"}
                      onClick={() => setSelectedPath(shape.path)}
                    >
                      <span className="lm-pptx-shape-kind">
                        {shape.isTitle ? "标题" : "文本"}
                        {dirtyShape ? " · 已改" : ""}
                      </span>
                      <span className="lm-pptx-shape-preview">
                        {(edits.get(shape.path) ?? shape.text).slice(0, 60) || "（空）"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selectedShape ? (
              <label className="lm-pptx-edit-field">
                <span className="lm-meta">
                  编辑{selectedShape.isTitle ? "标题" : "文本框"}
                </span>
                <textarea
                  className="lm-input lm-pptx-edit-textarea"
                  data-testid="lm-pptx-edit-textarea"
                  rows={6}
                  value={draftText}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedPath(selectedShape.path);
                    setEdits((prev) => {
                      const map = new Map(prev);
                      if (next === selectedShape.text) {
                        map.delete(selectedShape.path);
                      } else {
                        map.set(selectedShape.path, next);
                      }
                      return map;
                    });
                  }}
                />
              </label>
            ) : (
              <p className="lm-meta">本页没有可编辑文字形状。</p>
            )}
            <p className="lm-meta lm-pptx-preview-note">
              画面为幻灯片预览；右侧可改文字并保存。复杂排版请用本机 WPS / PowerPoint。
            </p>
          </aside>
        </div>
      ) : (
        <div className="lm-pptx-preview-body">
          <aside className="lm-pptx-rail lm-scroll" aria-label="幻灯片目录">
            <ol className="lm-pptx-rail-list">
              {textSlides.map((slide, index) => {
                const selected = index === activeIndex;
                const title =
                  slide.blocks.find((b) => b.role === "title" || b.role === "subtitle")?.text ||
                  slide.blocks.find((b) => b.role === "body")?.text ||
                  `第 ${slide.label} 页`;
                return (
                  <li key={slide.index}>
                    <button
                      type="button"
                      className="lm-pptx-rail-item"
                      data-selected={selected ? "1" : "0"}
                      onClick={() => setActiveIndex(index)}
                    >
                      <span className="lm-pptx-rail-num">{slide.label}</span>
                      <span className="lm-pptx-rail-title">{title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>
          <section className="lm-pptx-stage lm-scroll">
            {activeText ? (
              <article className="lm-pptx-slide-card" data-testid="lm-pptx-active-slide">
                {activeText.blocks.map((block, i) => {
                  if (block.role === "title") {
                    return (
                      <h2 key={`t-${i}`} className="lm-pptx-slide-title">
                        {block.text}
                      </h2>
                    );
                  }
                  if (block.role === "subtitle") {
                    return (
                      <p key={`s-${i}`} className="lm-pptx-slide-subtitle">
                        {block.text}
                      </p>
                    );
                  }
                  if (block.role === "notes") {
                    return (
                      <div key={`n-${i}`} className="lm-pptx-slide-notes">
                        <span className="lm-pptx-notes-label">备注</span>
                        <p>{block.text}</p>
                      </div>
                    );
                  }
                  return (
                    <p key={`b-${i}`} className="lm-pptx-slide-body">
                      {block.text}
                    </p>
                  );
                })}
              </article>
            ) : null}
            <p className="lm-meta lm-pptx-preview-note">
              当前为文字降级预览（本机幻灯片渲染不可用）。可用本机应用打开完整版式。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
