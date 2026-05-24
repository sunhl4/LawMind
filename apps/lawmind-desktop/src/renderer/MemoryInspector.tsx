/**
 * MemoryInspector — W6
 *
 * 列出 MemoryAdoptionService 的待审记忆建议（pending）+ 已采纳历史。
 * 律师可对每条建议执行五选一动作：
 *   - 采纳（Adopt）
 *   - 暂存为 temporary（仅 dismiss + 保留 note）
 *   - 改写后采纳（弹简易输入框 → adopt）
 *   - 永久忽略（dismiss）
 *   - 推迟决定（关闭面板，不动状态）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LawmindMemoryTruthSources } from "./LawmindMemoryTruthSources.js";
import { memoryScopeLabel } from "./lawmind-memory-scope.js";

const SCOPES = ["matter", "lawyer", "playbook", "client", "firm", "assistant", "opponent", "project"] as const;
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
  if (opts.scope) {params.set("scope", opts.scope);}
  if (opts.state) {params.set("state", opts.state);}
  if (opts.matterId) {params.set("matterId", opts.matterId);}
  const res = await fetch(`${opts.baseUrl}/api/memory/adoption?${params.toString()}`);
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as ApiResult<unknown>;
}

type Props = {
  baseUrl: string;
  matterId?: string;
  defaultScope?: Scope;
};

export default function MemoryInspector({ baseUrl, matterId, defaultScope }: Props) {
  const [scope, setScope] = useState<Scope | undefined>(defaultScope);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [previewId, setPreviewId] = useState<string | undefined>();
  const [previewDiff, setPreviewDiff] = useState<PreviewDiff | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | undefined>();

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

  const onAdopt = useCallback(
    async (id: string, note?: string) => {
      setBusyId(id);
      try {
        const res = await postAction(baseUrl, "adopt", { id, note });
        if (!res.ok) {
          setError(res.error ?? "adopt failed");
        }
      } finally {
        setBusyId(undefined);
        await refresh();
      }
    },
    [baseUrl, refresh],
  );

  const onDismiss = useCallback(
    async (id: string, note?: string) => {
      setBusyId(id);
      try {
        const res = await postAction(baseUrl, "dismiss", { id, note });
        if (!res.ok) {
          setError(res.error ?? "dismiss failed");
        }
      } finally {
        setBusyId(undefined);
        await refresh();
      }
    },
    [baseUrl, refresh],
  );

  const onRewrite = useCallback(
    async (id: string) => {
      const note = window.prompt("改写后采纳：请输入修订后的内容（将作为 adopt note 记录）", "");
      if (note === null) {return;}
      await onAdopt(id, note);
    },
    [onAdopt],
  );

  const onTemporary = useCallback(
    async (id: string) => {
      // "暂存为 temporary" 等价于 dismiss + 标注 temporary
      await onDismiss(id, "temporary");
    },
    [onDismiss],
  );

  const loadPreviewDiff = useCallback(
    async (id: string) => {
      if (previewId === id && previewDiff) {
        setPreviewId(undefined);
        setPreviewDiff(null);
        setPreviewErr(undefined);
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
    [baseUrl, matterId, previewDiff, previewId],
  );

  const copySourceTaskId = useCallback(async (taskId: string) => {
    try {
      await navigator.clipboard.writeText(taskId);
    } catch {
      window.prompt("复制以下任务 ID：", taskId);
    }
  }, []);

  const grouped = useMemo(() => {
    const out: Record<string, Suggestion[]> = {};
    for (const item of items) {
      out[item.scope] = out[item.scope] ?? [];
      out[item.scope].push(item);
    }
    return out;
  }, [items]);

  return (
    <section className="memory-inspector" aria-label="记忆采纳建议">
      <LawmindMemoryTruthSources apiBase={baseUrl} matterId={matterId} />
      <header className="memory-inspector__header">
        <h3>记忆采纳建议</h3>
        <div className="memory-inspector__filters">
          <label>
            范围:
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
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            刷新
          </button>
        </div>
      </header>

      {error ? <div className="memory-inspector__error">{error}</div> : null}

      {loading ? <p>加载中…</p> : null}
      {!loading && items.length === 0 ? <p>暂无 pending 建议。</p> : null}

      {Object.entries(grouped).map(([gscope, gitems]) => (
        <details key={gscope} open>
          <summary>
            <strong>{memoryScopeLabel(gscope)}</strong>（{gitems.length}）
          </summary>
          <ul className="memory-inspector__list">
            {gitems.map((item) => (
              <li key={item.id} className="memory-inspector__item">
                <header>
                  <span className="memory-inspector__kind">{item.kind}</span>
                  {item.targetId ? (
                    <span className="memory-inspector__target">{item.targetId}</span>
                  ) : null}
                  <span className="memory-inspector__meta" title={item.origin}>
                    {item.createdAt ? <time dateTime={item.createdAt}>{item.createdAt}</time> : null}
                    {item.origin ? (
                      <>
                        {item.createdAt ? " · " : null}
                        <span>{item.origin}</span>
                      </>
                    ) : null}
                  </span>
                  {item.sourceTaskId ? (
                    <>
                      <a
                        className="memory-inspector__task-link"
                        href={`#task/${item.sourceTaskId}`}
                        title="跳转到来源任务"
                      >
                        来源任务
                      </a>
                      <button
                        type="button"
                        className="memory-inspector__copy-id"
                        title="复制来源任务 ID"
                        onClick={() => void copySourceTaskId(item.sourceTaskId!)}
                      >
                        复制 ID
                      </button>
                    </>
                  ) : null}
                </header>
                <pre className="memory-inspector__payload">{item.payload}</pre>
                {previewId === item.id && previewDiff ? (
                  <div className="memory-inspector__diff" aria-label="变更预览">
                    <p className="lm-meta">
                      目标文件：<code>{previewDiff.targetPath}</code>（{previewDiff.beforeCharCount} →{" "}
                      {previewDiff.afterCharCount} 字符，模拟采纳）
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
                <footer>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-sm"
                    disabled={previewBusy && previewId === item.id}
                    onClick={() => void loadPreviewDiff(item.id)}
                  >
                    {previewBusy && previewId === item.id
                      ? "加载预览…"
                      : previewId === item.id && previewDiff
                        ? "收起预览"
                        : "预览变更"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onAdopt(item.id)}
                    disabled={busyId === item.id}
                  >
                    采纳
                  </button>
                  <button
                    type="button"
                    onClick={() => void onTemporary(item.id)}
                    disabled={busyId === item.id}
                  >
                    暂存为 temporary
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRewrite(item.id)}
                    disabled={busyId === item.id}
                  >
                    改写后采纳
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDismiss(item.id, "ignored")}
                    disabled={busyId === item.id}
                  >
                    永久忽略
                  </button>
                  <button type="button" disabled>
                    推迟决定
                  </button>
                </footer>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
