import { useMemo, useState, type ReactNode } from "react";
import type { MatterSidebarRow } from "./lawmind-records-desk-state";

type Props = {
  rows: MatterSidebarRow[];
  selectedKey: string | null;
  onSelect: (matterId: string) => void;
  /** e.g. `lm-matter-sidebar-list--fill` when this is the primary sidebar body. */
  className?: string;
  /** Opens create-matter dialog (no-FS / empty-list path). */
  onCreateMatter?: () => void;
};

export function LawmindMatterSidebarList(props: Props): ReactNode {
  const { rows, selectedKey, onSelect, className, onCreateMatter } = props;
  const [query, setQuery] = useState("");

  const matterRows = useMemo(() => {
    const base = rows.filter((r) => r.matterId);
    const q = query.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.matterId?.toLowerCase().includes(q) ?? false) ||
        (r.subline?.toLowerCase().includes(q) ?? false),
    );
  }, [query, rows]);

  return (
    <div
      className={`lm-matter-sidebar-list${className ? ` ${className}` : ""}`}
      role="navigation"
      aria-label="案件快捷列表"
    >
      <div className="lm-matter-sidebar-list-head">
        <span className="lm-matter-sidebar-list-title">案件</span>
        <span className="lm-matter-sidebar-list-count">{matterRows.length}</span>
        {onCreateMatter ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm lm-matter-sidebar-create"
            data-testid="lm-matter-sidebar-create"
            onClick={onCreateMatter}
            title="新建案件"
            aria-label="新建案件"
          >
            新建
          </button>
        ) : null}
      </div>
      <input
        type="search"
        className="lm-matter-sidebar-search"
        placeholder="筛选案件…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="筛选案件"
      />
      {matterRows.length === 0 ? (
        <div className="lm-matter-sidebar-empty-wrap">
          <p className="lm-meta lm-matter-sidebar-empty">
            {query.trim()
              ? "无匹配案件"
              : onCreateMatter
                ? "暂无案件。点上方「新建」开始。"
                : "暂无案件。打开顶部「案件工作台」新建，或在对话空态点「新建案件」。"}
          </p>
          {!query.trim() && onCreateMatter ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-matter-sidebar-create-empty"
              onClick={onCreateMatter}
            >
              新建案件
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="lm-matter-sidebar-list-ul">
          {matterRows.map((row) => (
            <li key={row.key}>
              <button
                type="button"
                className={`lm-matter-sidebar-row ${selectedKey === row.key ? "active" : ""}`}
                onClick={() => {
                  if (row.matterId) {
                    onSelect(row.matterId);
                  }
                }}
              >
                <span className="lm-matter-sidebar-row-title">{row.title}</span>
                {row.subline ? <span className="lm-matter-sidebar-row-meta">{row.subline}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
