/**
 * 来源锚点 — 律师可见文案按法律报告「参见」体例，不展示 src-1 等内部码。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  citationFootnoteMarker,
  formatLawyerFacingCitation,
  looksLikeOpaqueSourceId,
  sourceKindLabelZh,
} from "../../../../src/lawmind/sources/citation-display.ts";
import { apiGetJson, errorMessage } from "./api-client";
import { scrollToSourceAnchor } from "./lawmind-source-anchor";
import { LawmindSourceAnnotations } from "./LawmindSourceAnnotations.js";

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
  sectionsCiting: Array<{ heading: string; anchorId?: string; excerpt?: string }>;
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
  /** Optional override label (defaults to resolved legal citation). */
  label?: string;
  matterId?: string;
  /** Footnote marker shown before the cite text (①…). */
  marker?: string;
  /** Eager-load preview so the chip never flashes opaque ids. */
  eager?: boolean;
};

async function fetchSourcePreview(
  apiBase: string,
  sourceId: string,
  taskId?: string,
): Promise<SourcePreviewPayload> {
  const path = taskId
    ? `/api/sources/${encodeURIComponent(sourceId)}/preview?taskId=${encodeURIComponent(taskId)}`
    : `/api/sources/${encodeURIComponent(sourceId)}/preview`;
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
  return {
    source: j.source,
    supportingClaims: j.supportingClaims ?? [],
    taskId: j.taskId ?? taskId ?? "",
    sectionsCiting: j.sectionsCiting ?? [],
  };
}

/**
 * Tooltip placement is naive on purpose — pinned below the pill and clipped by
 * the popover's max-width. We rely on CSS to keep it readable on narrow panels.
 */
export function LawmindSourcePill(props: Props): ReactNode {
  const { apiBase, sourceId, taskId, label, matterId, marker, eager = true } = props;
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
    const job = (async () => {
      try {
        const payload = await fetchSourcePreview(apiBase, sourceId, taskId);
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
    if (eager) {
      void ensureLoaded();
    }
  }, [eager, ensureLoaded]);

  useEffect(() => {
    if (open && state.kind === "idle") {
      void ensureLoaded();
    }
  }, [open, state.kind, ensureLoaded]);

  const displayLabel = useMemo(() => {
    if (label?.trim()) {
      return label.trim();
    }
    if (state.kind === "ready") {
      return formatLawyerFacingCitation(state.data.source);
    }
    if (state.kind === "error") {
      return "引用待核实";
    }
    // Never flash opaque ids while loading.
    if (looksLikeOpaqueSourceId(sourceId)) {
      return state.kind === "loading" ? "加载引用…" : "引用";
    }
    return sourceId;
  }, [label, state, sourceId]);

  const pillText = marker ? `${marker}${displayLabel}` : displayLabel;

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
        aria-label={`参见：${displayLabel}`}
        title={displayLabel}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
      >
        {pillText}
      </button>
      {open ? (
        <div className="lm-source-popover" role="tooltip">
          {state.kind === "loading" ? <div className="lm-meta">加载出处…</div> : null}
          {state.kind === "error" ? (
            <div className="lm-callout lm-callout-danger" role="alert">
              <p className="lm-callout-body">{state.message}</p>
            </div>
          ) : null}
          {state.kind === "ready" ? (
            <SourcePopoverBody apiBase={apiBase} matterId={matterId} data={state.data} />
          ) : null}
          {state.kind === "idle" ? <div className="lm-meta">悬停以查看出处</div> : null}
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

function shortUrlLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") || "原文链接";
  } catch {
    return "原文链接";
  }
}

function SourcePopoverBody(props: {
  apiBase: string;
  matterId?: string;
  data: SourcePreviewPayload;
}): ReactNode {
  const { apiBase, matterId, data } = props;
  const { source, supportingClaims, sectionsCiting } = data;
  const cite = formatLawyerFacingCitation(source);
  return (
    <div className="lm-source-popover-body">
      <div className="lm-source-popover-head">
        <span className="lm-source-popover-kind">{sourceKindLabelZh(source.kind)}</span>
      </div>
      <div className="lm-source-popover-cite">{cite}</div>
      {source.title?.trim() &&
      source.title.trim() !== cite &&
      !looksLikeOpaqueSourceId(source.title) ? (
        <div className="lm-source-popover-title">{source.title}</div>
      ) : null}
      <ul className="lm-source-popover-meta">
        {source.court ? <li>裁判机构：{source.court}</li> : null}
        {source.caseNumber ? <li>案号：{source.caseNumber}</li> : null}
        {source.date ? <li>日期：{source.date}</li> : null}
      </ul>
      {source.url ? (
        <div className="lm-source-popover-actions">
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            onClick={() => openSourceInSystemBrowser(source.url!)}
            title={source.url}
          >
            打开原文（{shortUrlLabel(source.url)}）
          </button>
        </div>
      ) : null}
      {sectionsCiting.length > 0 ? (
        <div className="lm-source-popover-section">
          <div className="lm-source-popover-section-title">本草稿引用位置</div>
          <ul className="lm-source-popover-sections">
            {sectionsCiting.map((s) => (
              <li key={s.anchorId ?? s.heading}>
                <span>「{s.heading}」</span>
                {s.excerpt ? <p className="lm-meta">{s.excerpt}</p> : null}
                {s.anchorId ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    onClick={() => scrollToSourceAnchor(s.anchorId!)}
                  >
                    跳转到正文
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {supportingClaims.length > 0 ? (
        <div className="lm-source-popover-section">
          <div className="lm-source-popover-section-title">相关要点</div>
          <ul>
            {supportingClaims.slice(0, 4).map((c, idx) => (
              <li key={idx}>
                <span className="lm-source-popover-claim">{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <LawmindSourceAnnotations
        apiBase={apiBase}
        sourceId={source.id}
        taskId={data.taskId || undefined}
        matterId={matterId}
      />
    </div>
  );
}

/** 节末「参见」列表：①法条；②案号 — 符合一般法律报告体例。 */
export function LawmindSourcePillList(props: {
  apiBase: string;
  taskId?: string;
  sourceIds: string[];
  matterId?: string;
}): ReactNode {
  const { apiBase, taskId, sourceIds, matterId } = props;
  const uniqueIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of sourceIds) {
      const id = raw?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [sourceIds]);

  if (uniqueIds.length === 0) {
    return null;
  }

  return (
    <span className="lm-legal-cites" aria-label="参见">
      <span className="lm-legal-cites-label">参见</span>
      <span className="lm-legal-cites-items">
        {uniqueIds.map((id, index) => (
          <span key={id} className="lm-legal-cites-item">
            <LawmindSourcePill
              apiBase={apiBase}
              taskId={taskId}
              sourceId={id}
              matterId={matterId}
              marker={citationFootnoteMarker(index)}
              eager
            />
            {index < uniqueIds.length - 1 ? (
              <span className="lm-legal-cites-sep" aria-hidden>
                ；
              </span>
            ) : (
              <span className="lm-legal-cites-sep" aria-hidden>
                。
              </span>
            )}
          </span>
        ))}
      </span>
    </span>
  );
}
