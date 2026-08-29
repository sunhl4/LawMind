/**
 * MemoryInspector — 待确认记忆建议队列。
 * 默认动作：确认 / 改写；预览·稍后·忽略收进「更多」。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LawmindMemoryTruthSources } from "./LawmindMemoryTruthSources.js";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import { memoryKindLabel, memoryScopeLabel } from "./lawmind-memory-scope.js";

const SCOPES = ["matter", "lawyer", "playbook", "client", "firm", "assistant", "opponent", "project"] as const;
/** Lawyer-facing subset for manual suggest (simple mode). */
const SIMPLE_SCOPES = ["lawyer", "matter", "firm"] as const;
type Scope = (typeof SCOPES)[number];
type State = "pending" | "adopted" | "auto_adopted" | "dismissed";

type Suggestion = {
  id: string;
  createdAt: string;
  state: State;
  scope: Scope;
  kind: string;
  targetId?: string;
  payload: string;
  sourceTaskId?: string;
  origin: string;
  note?: string;
  resolvedAt?: string;
};

type DiffHunk = { type: "equal" | "add" | "remove"; lines: string[] };

type PreviewDiff = {
  targetPath: string;
  beforeCharCount: number;
  afterCharCount: number;
  hunks: DiffHunk[];
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error?: string };
type ApiResult<T> = ApiOk<T> | ApiErr;

async function fetchSuggestions(opts: {
  baseUrl: string;
  scope?: Scope;
  state?: State;
  matterId?: string;
}): Promise<Suggestion[]> {
  const params = new URLSearchParams();
  if (opts.scope) {
    params.set("scope", opts.scope);
  }
  if (opts.state) {
    params.set("state", opts.state);
  }
  if (opts.matterId) {
    params.set("matterId", opts.matterId);
  }
  const res = await fetch(`${opts.baseUrl}/api/memory/adoption?${params.toString()}`, {
    headers: { ...apiAuthHeaders() },
  });
  const json = (await res.json()) as ApiResult<{ items: Suggestion[] }>;
  return "items" in json && json.items ? json.items : [];
}

async function postAction(
  baseUrl: string,
  action: "adopt" | "dismiss",
  body: { id: string; note?: string },
): Promise<ApiResult<unknown>> {
  const res = await fetch(`${baseUrl}/api/memory/adoption/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...apiAuthHeaders() },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ApiResult<unknown>;
}

type Props = {
  baseUrl: string;
  matterId?: string;
  defaultScope?: Scope;
  /** When false, omit the archive inventory block (settings hosts it separately). */
  showTruthSources?: boolean;
  /** Flat list + fewer controls for lawyers (settings default). */
  simpleMode?: boolean;
  /** Report pending queue size (includes session-snoozed items still in API pending). */
  onPendingCountChange?: (count: number) => void;
};

export default function MemoryInspector({
  baseUrl,
  matterId,
  defaultScope,
  showTruthSources = true,
  simpleMode = false,
  onPendingCountChange,
}: Props) {
  const [scope, setScope] = useState<Scope | undefined>(defaultScope);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [previewId, setPreviewId] = useState<string | undefined>();
  const [previewDiff, setPreviewDiff] = useState<PreviewDiff | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | undefined>();
  const [suggestScope, setSuggestScope] = useState<Scope>(defaultScope ?? "lawyer");
  const [suggestKind, setSuggestKind] = useState("lawyer.profile_learning");
  const [suggestPayload, setSuggestPayload] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [rewriteId, setRewriteId] = useState<string | undefined>();
  const [rewriteText, setRewriteText] = useState("");
  /** 「稍后再说」：仅本会话隐藏，不写库。 */
  const [snoozedIds, setSnoozedIds] = useState<ReadonlySet<string>>(() => new Set());

  const scopeOptions = simpleMode ? SIMPLE_SCOPES : SCOPES;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const list = await fetchSuggestions({
        baseUrl,
        scope,
        state: "pending",
        matterId,
      });
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, scope, matterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    onPendingCountChange?.(items.length);
  }, [items.length, onPendingCountChange]);

  const clearPreview = useCallback(() => {
    setPreviewId(undefined);
    setPreviewDiff(null);
    setPreviewErr(undefined);
  }, []);

  const onAdopt = useCallback(
    async (id: string, note?: string) => {
      setBusyId(id);
      try {
        const res = await postAction(baseUrl, "adopt", { id, note });
        if (!res.ok) {
          setError(res.error ?? "确认写入失败");
        } else {
          setRewriteId(undefined);
          setRewriteText("");
          clearPreview();
        }
      } finally {
        setBusyId(undefined);
        await refresh();
      }
    },
    [baseUrl, clearPreview, refresh],
  );

  const onDismiss = useCallback(
    async (id: string, note?: string) => {
      setBusyId(id);
      try {
        const res = await postAction(baseUrl, "dismiss", { id, note });
        if (!res.ok) {
          setError(res.error ?? "忽略失败");
        } else {
          if (rewriteId === id) {
            setRewriteId(undefined);
            setRewriteText("");
          }
          if (previewId === id) {
            clearPreview();
          }
        }
      } finally {
        setBusyId(undefined);
        await refresh();
      }
    },
    [baseUrl, clearPreview, previewId, refresh, rewriteId],
  );

  const beginRewrite = useCallback((item: Suggestion) => {
    setRewriteId(item.id);
    setRewriteText(item.payload);
    setError(undefined);
  }, []);

  const cancelRewrite = useCallback(() => {
    setRewriteId(undefined);
    setRewriteText("");
  }, []);

  const confirmRewrite = useCallback(async () => {
    if (!rewriteId) {
      return;
    }
    const next = rewriteText.trim();
    if (!next) {
      setError("改写内容不能为空");
      return;
    }
    await onAdopt(rewriteId, next);
  }, [onAdopt, rewriteId, rewriteText]);

  const onSnooze = useCallback(
    (id: string) => {
      setSnoozedIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      if (previewId === id) {
        clearPreview();
      }
      if (rewriteId === id) {
        cancelRewrite();
      }
    },
    [cancelRewrite, clearPreview, previewId, rewriteId],
  );

  const loadPreviewDiff = useCallback(
    async (id: string) => {
      if (previewId === id && previewDiff) {
        clearPreview();
        return;
      }
      setPreviewBusy(true);
      setPreviewErr(undefined);
      setPreviewId(id);
      try {
        const params = new URLSearchParams();
        if (matterId) {
          params.set("matterId", matterId);
        }
        const q = params.toString();
        const res = await fetch(
          `${baseUrl}/api/memory/adoption/${encodeURIComponent(id)}/preview-diff${q ? `?${q}` : ""}`,
          { headers: { ...apiAuthHeaders() } },
        );
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          hint?: string;
          targetPath?: string;
          beforeCharCount?: number;
          afterCharCount?: number;
          hunks?: DiffHunk[];
        };
        if (!json.ok || !json.targetPath || !json.hunks) {
          setPreviewDiff(null);
          setPreviewErr(json.hint ?? json.error ?? "无法加载变更预览");
          return;
        }
        setPreviewDiff({
          targetPath: json.targetPath,
          beforeCharCount: json.beforeCharCount ?? 0,
          afterCharCount: json.afterCharCount ?? 0,
          hunks: json.hunks,
        });
      } catch (err) {
        setPreviewDiff(null);
        setPreviewErr(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewBusy(false);
      }
    },
    [baseUrl, clearPreview, matterId, previewDiff, previewId],
  );

  const onSuggest = useCallback(async () => {
    const payload = suggestPayload.trim();
    if (!payload) {
      setError("请填写内容");
      return;
    }
    setSuggestBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`${baseUrl}/api/memory/adoption/suggest`, {
        method: "POST",
        headers: { "content-type": "application/json", ...apiAuthHeaders() },
        body: JSON.stringify({
          scope: suggestScope,
          kind: suggestKind,
          payload,
          targetId: matterId,
        }),
      });
      const json = (await res.json()) as ApiResult<{ id?: string }>;
      if (!json.ok) {
        setError(("error" in json && json.error) || "提交失败");
        return;
      }
      setSuggestPayload("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggestBusy(false);
    }
  }, [baseUrl, matterId, refresh, suggestKind, suggestPayload, suggestScope]);

  const visibleItems = useMemo(() => {
    const list = items.filter((item) => !snoozedIds.has(item.id));
    return [...list].toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [items, snoozedIds]);

  const snoozedCount = useMemo(
    () => items.reduce((n, item) => (snoozedIds.has(item.id) ? n + 1 : n), 0),
    [items, snoozedIds],
  );

  const renderItem = (item: Suggestion) => (
    <li key={item.id} className="memory-inspector__item">
      <header className="memory-inspector__item-head">
        <span className="memory-inspector__kind" title={item.kind}>
          {memoryKindLabel(item.kind)}
        </span>
        <span className="memory-inspector__scope-pill">{memoryScopeLabel(item.scope)}</span>
        {!simpleMode && item.targetId ? (
          <span className="memory-inspector__target">{item.targetId}</span>
        ) : null}
        <span className="memory-inspector__meta">
          {item.createdAt ? (
            <time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
          ) : null}
        </span>
      </header>
      {rewriteId === item.id ? (
        <div className="memory-inspector__rewrite">
          <label>
            改写内容
            <textarea
              className="lm-input"
              rows={3}
              value={rewriteText}
              onChange={(e) => setRewriteText(e.target.value)}
              autoFocus
            />
          </label>
          <div className="memory-inspector__rewrite-actions">
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              disabled={busyId === item.id}
              onClick={() => void confirmRewrite()}
            >
              {busyId === item.id ? "写入中…" : "确认写入"}
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={busyId === item.id}
              onClick={cancelRewrite}
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="memory-inspector__payload">{item.payload}</p>
      )}
      {previewId === item.id && previewDiff ? (
        <div className="memory-inspector__diff" aria-label="变更预览">
          <p className="lm-meta">
            写入后约 {previewDiff.afterCharCount} 字
            {!simpleMode ? (
              <>
                （<code>{previewDiff.targetPath}</code>）
              </>
            ) : null}
          </p>
          <pre className="memory-inspector__diff-body">
            {previewDiff.hunks.map((hunk, hi) => (
              <span key={hi} className={`lm-diff-${hunk.type}`}>
                {hunk.lines.map((line, li) => (
                  <span key={li}>
                    {hunk.type === "add" ? "+ " : hunk.type === "remove" ? "- " : "  "}
                    {line}
                    {"\n"}
                  </span>
                ))}
              </span>
            ))}
          </pre>
        </div>
      ) : null}
      {previewId === item.id && previewErr ? (
        <p className="memory-inspector__error">{previewErr}</p>
      ) : null}
      {rewriteId === item.id ? null : (
        <footer className="memory-inspector__actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            onClick={() => void onAdopt(item.id)}
            disabled={busyId === item.id}
          >
            确认
          </button>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            onClick={() => beginRewrite(item)}
            disabled={busyId === item.id}
          >
            改写
          </button>
          <details className="memory-inspector__more">
            <summary>更多</summary>
            <div className="memory-inspector__more-body">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={previewBusy && previewId === item.id}
                onClick={() => void loadPreviewDiff(item.id)}
              >
                {previewBusy && previewId === item.id
                  ? "预览中…"
                  : previewId === item.id && previewDiff
                    ? "收起预览"
                    : "预览变更"}
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={() => onSnooze(item.id)}
                disabled={busyId === item.id}
              >
                稍后再说
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={() => void onDismiss(item.id, "ignored")}
                disabled={busyId === item.id}
              >
                忽略
              </button>
            </div>
          </details>
        </footer>
      )}
    </li>
  );

  const suggestOptions = (
    <div className="memory-inspector__suggest-row">
      <label>
        归入
        <select
          value={suggestScope}
          onChange={(e) => setSuggestScope(e.target.value as Scope)}
        >
          {scopeOptions.map((s) => (
            <option key={s} value={s}>
              {memoryScopeLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <label>
        类型
        <select value={suggestKind} onChange={(e) => setSuggestKind(e.target.value)}>
          <option value="lawyer.profile_learning">办案偏好</option>
          <option value="case.core_issue">核心争点</option>
          <option value="case.risk_note">风险备注</option>
          <option value="playbook.clause_learning">条款审查要点</option>
          <option value="firm.preference">所内惯例</option>
          {!simpleMode ? (
            <option value="assistant.profile_section">助手补充</option>
          ) : null}
        </select>
      </label>
    </div>
  );

  const suggestForm = (
    <div className="memory-inspector__suggest-form">
      <label>
        内容
        <textarea
          className="lm-input"
          rows={simpleMode ? 2 : 3}
          value={suggestPayload}
          onChange={(e) => setSuggestPayload(e.target.value)}
          placeholder="一两句说清要点即可"
        />
      </label>
      {simpleMode ? (
        <details className="lm-memory-fold lm-memory-fold--nested">
          <summary>
            <span className="lm-memory-fold__label">归入与类型</span>
            <span className="lm-memory-fold__hint">
              {memoryScopeLabel(suggestScope)} · {memoryKindLabel(suggestKind)}
            </span>
          </summary>
          <div className="lm-memory-fold__body">{suggestOptions}</div>
        </details>
      ) : (
        suggestOptions
      )}
      <div className="lm-memory-fold__actions">
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          data-testid="lm-memory-suggest-submit"
          disabled={suggestBusy}
          onClick={() => void onSuggest()}
        >
          {suggestBusy ? "提交中…" : "加入待确认"}
        </button>
      </div>
    </div>
  );

  return (
    <section className={`memory-inspector${simpleMode ? " memory-inspector--simple" : ""}`} aria-label="待确认建议">
      {showTruthSources ? <LawmindMemoryTruthSources apiBase={baseUrl} matterId={matterId} /> : null}

      {error ? (
        <div className="memory-inspector__error" role="alert">
          {error}
        </div>
      ) : null}

      {snoozedCount > 0 ? (
        <p className="memory-inspector__snooze-hint">
          已暂时收起 {snoozedCount} 条
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            onClick={() => setSnoozedIds(new Set())}
          >
            重新显示
          </button>
        </p>
      ) : null}

      {loading ? <p className="lm-settings-caption">加载中…</p> : null}
      {!loading && items.length === 0 ? (
        <div className="lm-memory-empty lm-memory-empty--compact">
          <p className="lm-memory-empty__title">暂无待确认项</p>
          <p className="lm-memory-empty__desc">暂无建议。</p>
        </div>
      ) : null}
      {!loading && items.length > 0 && visibleItems.length === 0 ? (
        <div className="lm-memory-empty lm-memory-empty--compact">
          <p className="lm-memory-empty__title">本页已全部收起</p>
          <p className="lm-memory-empty__desc">点「重新显示」继续处理。</p>
        </div>
      ) : null}

      {!simpleMode ? (
        <header className="memory-inspector__header">
          <div className="memory-inspector__filters">
            <label>
              分类
              <select
                value={scope ?? ""}
                onChange={(e) => setScope((e.target.value || undefined) as Scope | undefined)}
              >
                <option value="">全部</option>
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {memoryScopeLabel(s)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => void refresh()}
              disabled={loading}
            >
              刷新
            </button>
          </div>
        </header>
      ) : null}

      {visibleItems.length > 0 ? (
        <ul className="memory-inspector__list memory-inspector__list--flat">{visibleItems.map(renderItem)}</ul>
      ) : null}

      <details className="lm-memory-fold lm-memory-fold--secondary" data-testid="lm-memory-suggest">
        <summary>
          <span className="lm-memory-fold__label">自己补充一条</span>
          <span className="lm-memory-fold__hint">可选</span>
        </summary>
        <div className="lm-memory-fold__body">{suggestForm}</div>
      </details>
    </section>
  );
}
