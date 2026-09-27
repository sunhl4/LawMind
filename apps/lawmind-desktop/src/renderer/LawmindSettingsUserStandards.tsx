/**
 * 律师自建审查标准。改完只影响之后的办件；学习来的条目默认关闭，需确认才启用。
 * 案由用内置词表，在谈话里点选，不在这里维护全文。
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type StandardKind = "contract_review" | "litigation_intake" | "daily_triage";
type StandardSource = "builtin" | "lawyer" | "learned";

type UserStandardRow = {
  id: string;
  title: string;
  kind: StandardKind;
  enabled: boolean;
  source: StandardSource;
  items: Array<{ text: string; tone?: string }>;
  bindWhen?: { keywords?: string[] };
};

const KIND_LABELS: Record<StandardKind, string> = {
  contract_review: "合同审查",
  litigation_intake: "诉讼收案",
  daily_triage: "每日分拣",
};

type Props = {
  apiBase: string;
};

export function LawmindSettingsUserStandards(props: Props): ReactNode {
  const { apiBase } = props;
  const [standards, setStandards] = useState<UserStandardRow[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<StandardKind>("contract_review");
  const [items, setItems] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const loadAll = async () => {
    const std = await apiGetJson<{ ok?: boolean; standards?: UserStandardRow[] }>(
      apiBase,
      "/api/workspace/standards",
    );
    if (std.ok && std.standards) {
      setStandards(std.standards);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadAll().catch((e) => {
      if (!cancelled) {
        setHint(errorMessage(e, "加载标准失败"));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function saveNew(): Promise<void> {
    const nextTitle = title.trim();
    const nextItems = items
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text) => ({ text, tone: "check" as const }));
    if (!nextTitle || nextItems.length === 0) {
      setHint("请填写标题和至少一条核对项。");
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/workspace/standards", "POST", {
        title: nextTitle,
        kind,
        enabled: true,
        items: nextItems,
        bindWhen: {
          keywords: keywords
            .split(/[,，\n]/)
            .map((k) => k.trim())
            .filter(Boolean),
        },
      });
      setTitle("");
      setItems("");
      setKeywords("");
      await loadAll();
      setHint("已保存。只影响之后的办件，已生成草稿不会重算。");
    } catch (e) {
      setHint(errorMessage(e, "保存标准失败"));
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(row: UserStandardRow, enabled: boolean): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, "/api/workspace/standards", "POST", {
        id: row.id,
        title: row.title,
        kind: row.kind,
        enabled,
        items: row.items,
        bindWhen: row.bindWhen,
      });
      await loadAll();
      setHint(enabled ? "已启用。之后的审查会套用这条。" : "已停用。之后的审查不再套用。");
    } catch (e) {
      setHint(errorMessage(e, "更新标准失败"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      await apiSendJson(apiBase, `/api/workspace/standards/${encodeURIComponent(id)}`, "DELETE");
      await loadAll();
      setHint("已删除。");
    } catch (e) {
      setHint(errorMessage(e, "删除失败（内置标准不能删）"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="lm-settings-advanced" data-testid="lm-user-standards">
        <summary>
          <span className="lm-settings-advanced__label">审查标准</span>
          <span className="lm-settings-advanced__hint">按合同类型或客户自动套用</span>
        </summary>
        <div className="lm-settings-advanced-body">
          <p className="lm-settings-caption">
            写你自己的审查口径。命中时审查会带上；可停用或本次不用。学习来的红线默认关闭，点「确认启用」才生效。
          </p>
          <ul className="lm-settings-list" data-testid="lm-user-standards-list">
            {standards.map((row) => (
              <li key={row.id} className="lm-settings-list-row">
                <div>
                  <strong>{row.title}</strong>
                  <span className="lm-settings-caption">
                    {KIND_LABELS[row.kind]}
                    {row.source === "learned" ? " · 待确认" : row.source === "builtin" ? " · 内置" : ""}
                    {row.enabled ? "" : " · 已停用"}
                  </span>
                </div>
                <div className="lm-settings-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    disabled={busy}
                    onClick={() => void setEnabled(row, !row.enabled)}
                  >
                    {row.enabled ? "停用" : row.source === "learned" ? "确认启用" : "启用"}
                  </button>
                  {row.source !== "builtin" ? (
                    <button
                      type="button"
                      className="lm-btn lm-btn-ghost lm-btn-sm"
                      disabled={busy}
                      onClick={() => void remove(row.id)}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <label className="lm-settings-field">
            <span className="lm-settings-key">新标准标题</span>
            <input
              className="lm-input"
              value={title}
              data-testid="lm-user-standards-title"
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如 某客户买卖合同口径"
            />
          </label>
          <label className="lm-settings-field">
            <span className="lm-settings-key">门类</span>
            <select
              className="lm-input"
              value={kind}
              data-testid="lm-user-standards-kind"
              onChange={(e) => setKind(e.target.value as StandardKind)}
            >
              {(Object.keys(KIND_LABELS) as StandardKind[]).map((id) => (
                <option key={id} value={id}>
                  {KIND_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
          <label className="lm-settings-field">
            <span className="lm-settings-key">核对项</span>
            <textarea
              className="lm-input"
              rows={3}
              value={items}
              data-testid="lm-user-standards-items"
              placeholder="一行一条"
              onChange={(e) => setItems(e.target.value)}
            />
          </label>
          <label className="lm-settings-field">
            <span className="lm-settings-key">触发词</span>
            <input
              className="lm-input"
              value={keywords}
              data-testid="lm-user-standards-keywords"
              placeholder="可选，逗号分隔；留空则按门类套用"
              onChange={(e) => setKeywords(e.target.value)}
            />
          </label>
          <div className="lm-settings-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={busy}
              data-testid="lm-user-standards-save"
              onClick={() => void saveNew()}
            >
              {busy ? "保存中…" : "新增标准"}
            </button>
          </div>
          {hint ? (
            <p className="lm-settings-caption" role="status">
              {hint}
            </p>
          ) : null}
        </div>
    </details>
  );
}
