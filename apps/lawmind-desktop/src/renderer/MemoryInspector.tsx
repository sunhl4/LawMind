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

export default function MemoryInspector({ baseUrl, matterId, defaultScope }: Props): JSX.Element {
  const [scope, setScope] = useState<Scope | undefined>(defaultScope);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();

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
      <header className="memory-inspector__header">
        <h3>记忆采纳建议</h3>
        <div className="memory-inspector__filters">
          <label>
            Scope:
            <select
              value={scope ?? ""}
              onChange={(e) => setScope((e.target.value || undefined) as Scope | undefined)}
            >
              <option value="">全部</option>
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
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
            <strong>{gscope}</strong>（{gitems.length}）
          </summary>
          <ul className="memory-inspector__list">
            {gitems.map((item) => (
              <li key={item.id} className="memory-inspector__item">
                <header>
                  <span className="memory-inspector__kind">{item.kind}</span>
                  {item.targetId ? (
                    <span className="memory-inspector__target">{item.targetId}</span>
                  ) : null}
                  {item.sourceTaskId ? (
                    <a
                      className="memory-inspector__task-link"
                      href={`#task/${item.sourceTaskId}`}
                      title="跳转到来源任务"
                    >
                      来源任务
                    </a>
                  ) : null}
                </header>
                <pre className="memory-inspector__payload">{item.payload}</pre>
                <footer>
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
