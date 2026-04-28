/**
 * LawmindSourcePreview — Deliverable-First Architecture P3 (来源锚点).
 *
 * <LawmindSourcePill /> renders a citation chip that, on hover, lazily fetches
 * `/api/sources/:id/preview?taskId=...` and surfaces:
 *   - the underlying source title + citation string + URL
 *   - the draft sections that cite it
 *   - the supporting research claims (text + confidence)
 *
 * Why: this is the trust seam that lets the lawyer click through every cite
 * back to the underlying authority — the differentiator vs Harvey / Spellbook
 * style "ungrounded" generation.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";

/** API `kind` string; 常见值含 statute、regulation、case、court_view、book、internal、other 等。 */
export type SourcePreviewKind = string;

export type SourcePreviewPayload = {
  source: {
    id: string;
    title: string;
    kind: SourcePreviewKind;
    citation?: string;
    url?: string;
    date?: string;
    court?: string;
    caseNumber?: string;
  };
  supportingClaims: Array<{
    text: string;
    sourceIds: string[];
    confidence: number;
    model: "general" | "legal";
  }>;
  taskId: string;
  sectionsCiting: Array<{ heading: string }>;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: SourcePreviewPayload }
  | { kind: "error"; message: string };

type Props = {
  apiBase: string;
  sourceId: string;
  /** Required for fast lookups; optional fall-back triggers a workspace scan. */
  taskId?: string;
  /** Optional override label (defaults to the source ID). */
  label?: string;
};

function kindLabel(kind: string): string {
  switch (kind) {
    case "statute":
      return "法条";
    case "regulation":
      return "法规";
    case "case":
      return "判例";
    case "court_view":
      return "司法观点";
    case "book":
      return "著作";
    case "internal":
      return "内部资料";
    default:
      return "其他";
  }
}

/**
 * Tooltip placement is naive on purpose — pinned below the pill and clipped by
 * the popover's max-width. We rely on CSS to keep it readable on narrow panels.
 */
export function LawmindSourcePill(props: Props): ReactNode {
  const { apiBase, sourceId, taskId, label } = props;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const cacheRef = useRef<SourcePreviewPayload | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);

  const ensureLoaded = useCallback(async () => {
    if (cacheRef.current) {
      setState({ kind: "ready", data: cacheRef.current });
      return;
    }
    if (inflightRef.current) {
      return inflightRef.current;
    }
    setState({ kind: "loading" });
    const path = taskId
      ? `/api/sources/${encodeURIComponent(sourceId)}/preview?taskId=${encodeURIComponent(taskId)}`
      : `/api/sources/${encodeURIComponent(sourceId)}/preview`;
    const job = (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          error?: string;
          source?: SourcePreviewPayload["source"];
          supportingClaims?: SourcePreviewPayload["supportingClaims"];
          taskId?: string;
          sectionsCiting?: SourcePreviewPayload["sectionsCiting"];
        }>(apiBase, path);
        if (!j.ok || !j.source) {
          throw new Error(j.error ?? "无法获取来源详情");
        }
        const payload: SourcePreviewPayload = {
          source: j.source,
          supportingClaims: j.supportingClaims ?? [],
          taskId: j.taskId ?? taskId ?? "",
          sectionsCiting: j.sectionsCiting ?? [],
        };
        cacheRef.current = payload;
        setState({ kind: "ready", data: payload });
      } catch (e) {
        setState({ kind: "error", message: errorMessage(e, "无法获取来源详情") });
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = job;
    return job;
  }, [apiBase, sourceId, taskId]);

  useEffect(() => {
    if (open && state.kind === "idle") {
      void ensureLoaded();
    }
  }, [open, state.kind, ensureLoaded]);

  return (
    <span
      className="lm-source-pill-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        className="lm-source-pill"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {label ?? sourceId}
      </button>
      {open ? (
        <div className="lm-source-popover" role="tooltip">
          {state.kind === "loading" ? <div className="lm-meta">加载来源详情…</div> : null}
          {state.kind === "error" ? (
            <div className="lm-callout lm-callout-danger" role="alert">
              <p className="lm-callout-body">{state.message}</p>
            </div>
          ) : null}
          {state.kind === "ready" ? <SourcePopoverBody data={state.data} /> : null}
          {state.kind === "idle" ? <div className="lm-meta">悬停以加载详情</div> : null}
        </div>
      ) : null}
    </span>
  );
}

function openSourceInSystemBrowser(url: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (window.lawmindDesktop?.openExternal) {
    void window.lawmindDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function SourcePopoverBody(props: { data: SourcePreviewPayload }): ReactNode {
  const { data } = props;
  const { source, supportingClaims, sectionsCiting } = data;
  return (
    <div className="lm-source-popover-body">
      <div className="lm-source-popover-head">
        <span className="lm-source-popover-kind">{kindLabel(source.kind)}</span>
        <span className="lm-source-popover-id">{source.id}</span>
      </div>
      <div className="lm-source-popover-title">{source.title}</div>
      {source.citation ? (
        <div className="lm-source-popover-cite">{source.citation}</div>
      ) : null}
      <ul className="lm-source-popover-meta">
        {source.court ? <li>裁判机构：{source.court}</li> : null}
        {source.caseNumber ? <li>案号：{source.caseNumber}</li> : null}
        {source.date ? <li>日期：{source.date}</li> : null}
        {source.url ? (
          <li>
            链接：
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>
          </li>
        ) : null}
      </ul>
      {source.url ? (
        <div className="lm-source-popover-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            onClick={() => openSourceInSystemBrowser(source.url!)}
          >
            在系统浏览器打开
          </button>
        </div>
      ) : null}
      {sectionsCiting.length > 0 ? (
        <div className="lm-source-popover-section">
          <div className="lm-source-popover-section-title">本草稿引用章节</div>
          <ul>
            {sectionsCiting.map((s) => (
              <li key={s.heading}>「{s.heading}」</li>
            ))}
          </ul>
        </div>
      ) : null}
      {supportingClaims.length > 0 ? (
        <div className="lm-source-popover-section">
          <div className="lm-source-popover-section-title">支撑结论</div>
          <ul>
            {supportingClaims.slice(0, 4).map((c, idx) => (
              <li key={idx}>
                <span className="lm-source-popover-claim">{c.text}</span>
                <span className="lm-source-popover-confidence">
                  {Math.round(c.confidence * 100)}% · {c.model === "legal" ? "法律模型" : "通用模型"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Convenience: render an inline list of source pills sharing the same taskId. */
export function LawmindSourcePillList(props: {
  apiBase: string;
  taskId?: string;
  sourceIds: string[];
}): ReactNode {
  const { apiBase, taskId, sourceIds } = props;
  if (sourceIds.length === 0) {
    return null;
  }
  return (
    <span className="lm-source-pill-list">
      {sourceIds.map((id) => (
        <LawmindSourcePill key={id} apiBase={apiBase} taskId={taskId} sourceId={id} />
      ))}
    </span>
  );
}
