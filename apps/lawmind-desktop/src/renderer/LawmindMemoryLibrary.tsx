/**
 * 记忆库：我的习惯 / 本案认知 / 已作废。
 * 确认才生效；撤回是主按钮。未确认的不进对话。
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CANONICAL_HABIT_KEYS, memoryKeyLabel } from "../../../../src/lawmind/memory/kernel/contract.ts";
import { fetchApiJson } from "./api-client-proxy.ts";

export type MemoryLibraryView = "habits" | "matter" | "revoked";

type MemoryRow = {
  id: string;
  kind: string;
  scope: string;
  scopeId: string;
  key: string;
  body: string;
  confirmation: "pending" | "confirmed" | "dismissed";
  validity: "current" | "superseded" | "revoked";
  origin?: string;
  sourceMatterId?: string;
  clientId?: string;
  updatedAt: string;
};

type ConfirmScope = "" | "lawyer" | "matter" | "client";

type ConfirmPlacement = {
  key: string;
  scope: ConfirmScope;
};

function defaultScope(item: MemoryRow): ConfirmScope {
  if (item.origin === "review" && item.sourceMatterId) {
    return "matter";
  }
  if (item.origin === "review" && item.clientId) {
    return "client";
  }
  return "";
}

type Props = {
  apiBase: string;
  view: MemoryLibraryView;
  matterId?: string;
};

const KIND_LABEL: Record<string, string> = {
  habit: "写法",
  stance: "条款立场",
  client_note: "客户",
  matter_fact: "本案",
  playbook_note: "所内",
};

async function loadRows(apiBase: string, view: MemoryLibraryView, matterId?: string): Promise<MemoryRow[]> {
  const params = new URLSearchParams({ view });
  if (matterId) {
    params.set("matterId", matterId);
  }
  const json = await fetchApiJson<{ ok?: boolean; items?: MemoryRow[]; error?: string }>(
    `${apiBase}/api/memory/library?${params.toString()}`,
    {},
    { tag: "memory-library:list" },
  );
  if (!json.ok || !json.items) {
    throw new Error(json.error ?? "读取记忆失败");
  }
  return json.items;
}

export function LawmindMemoryLibrary({ apiBase, view, matterId }: Props): ReactNode {
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [placement, setPlacement] = useState<Record<string, ConfirmPlacement>>({});

  const refresh = useCallback(async () => {
    try {
      setItems(await loadRows(apiBase, view, matterId));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [apiBase, matterId, view]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const post = useCallback(
    async (action: "confirm" | "revoke" | "dismiss" | "restore", id: string) => {
      setBusyId(id);
      try {
        const row = items.find((item) => item.id === id);
        const chosen = placement[id];
        const scope = chosen?.scope || (row ? defaultScope(row) : "");
        const scopeId =
          scope === "matter"
            ? matterId || row?.sourceMatterId || ""
            : scope === "client"
              ? row?.clientId || ""
              : undefined;
        const json = await fetchApiJson<{ ok?: boolean; error?: string }>(
          `${apiBase}/api/memory/library/${action}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id,
              ...(action === "confirm" && chosen?.key ? { key: chosen.key } : {}),
              ...(action === "confirm" && scope ? { scope, scopeId } : {}),
            }),
          },
          { tag: `memory-library:${action}` },
        );
        if (!json.ok) {
          setError(json.error ?? "操作失败");
        }
      } finally {
        setBusyId(undefined);
        await refresh();
      }
    },
    [apiBase, items, matterId, placement, refresh],
  );

  return (
    <div className="lm-memory-library" data-testid={`lm-memory-library-${view}`}>
      {view === "habits" ? (
        <p className="lm-memory-lead">
          从本案审核来的，确认后默认只留在本案。要变成以后都用的写法，先把「用于」改成「以后的稿子都用」。
        </p>
      ) : null}
      {view === "matter" && !matterId ? (
        <p className="lm-memory-lead">这里是各案已经记下的事实。打开某一案的认知页，只看该案。</p>
      ) : null}
      {error ? <p className="memory-inspector__error">{error}</p> : null}
      {items.length === 0 ? <p className="lm-meta">这一栏还没有记录。</p> : null}
      <ul className="memory-inspector__list memory-inspector__list--flat">
        {items.map((item) => (
          <li key={item.id} className="memory-inspector__item">
            <header className="memory-inspector__item-head">
              <span className="memory-inspector__kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
              <span className="memory-inspector__scope-pill">{memoryKeyLabel(item.key)}</span>
              {view === "matter" && !matterId && item.scopeId ? (
                <span className="memory-inspector__meta">{item.scopeId}</span>
              ) : null}
              {item.confirmation === "pending" ? (
                <span className="memory-inspector__meta">待确认</span>
              ) : null}
              {item.origin === "consolidation" ? (
                <span className="memory-inspector__meta">多个案件里同一写法，确认后才通用</span>
              ) : null}
              {item.validity === "superseded" ? (
                <span className="memory-inspector__meta">已被更新</span>
              ) : null}
              {item.validity === "revoked" ? <span className="memory-inspector__meta">已撤回</span> : null}
            </header>
            <p className="memory-inspector__payload">{item.body}</p>
            {view === "habits" && item.confirmation === "pending" ? (
              <div className="lm-memory-placement">
                <label>
                  记成
                  <select
                    className="lm-input"
                    value={placement[item.id]?.key ?? ""}
                    onChange={(event) =>
                      setPlacement((prev) => ({
                        ...prev,
                        [item.id]: { key: event.target.value, scope: prev[item.id]?.scope ?? "" },
                      }))
                    }
                  >
                    <option value="">就这一条，不替换别的写法</option>
                    {CANONICAL_HABIT_KEYS.map((row) => (
                      <option key={row.key} value={row.key}>
                        {row.label}（会替换同一种旧写法）
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  用于
                  <select
                    className="lm-input"
                    value={placement[item.id]?.scope ?? defaultScope(item)}
                    onChange={(event) => {
                      const next = event.target.value;
                      const scope: ConfirmScope =
                        next === "matter" || next === "lawyer" || next === "client" ? next : "";
                      setPlacement((prev) => ({
                        ...prev,
                        [item.id]: {
                          key: prev[item.id]?.key ?? "",
                          scope,
                        },
                      }));
                    }}
                  >
                    <option value="">保持现在的范围</option>
                    <option value="lawyer">以后的稿子都用</option>
                    <option value="matter" disabled={!matterId && !item.sourceMatterId}>
                      只限本案
                    </option>
                    <option value="client" disabled={!item.clientId}>
                      只限该客户
                    </option>
                  </select>
                </label>
              </div>
            ) : null}
            {view === "revoked" ? (
              <div className="memory-inspector__actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-sm"
                  disabled={busyId === item.id}
                  onClick={() => void post("restore", item.id)}
                >
                  恢复
                </button>
              </div>
            ) : (
              <div className="memory-inspector__actions">
                {item.confirmation === "pending" ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-accent lm-btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void post("confirm", item.id)}
                  >
                    确认
                  </button>
                ) : (
                  <button
                    type="button"
                    className="lm-btn lm-btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void post("revoke", item.id)}
                  >
                    撤回
                  </button>
                )}
                {item.confirmation === "pending" ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busyId === item.id}
                    onClick={() => void post("dismiss", item.id)}
                  >
                    忽略
                  </button>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
