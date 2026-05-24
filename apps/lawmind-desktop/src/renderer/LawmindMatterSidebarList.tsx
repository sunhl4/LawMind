import { useMemo, useState, type ReactNode } from "react";
import type { MatterSidebarRow } from "./lawmind-records-desk-state";

type Props = {
  rows: MatterSidebarRow[];
  selectedKey: string | null;
  onSelect: (matterId: string) => void;
};

export function LawmindMatterSidebarList(props: Props): ReactNode {
  const { rows, selectedKey, onSelect } = props;
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
    <div className="lm-matter-sidebar-list" role="navigation" aria-label="案件快捷列表">
      <div className="lm-matter-sidebar-list-head">
        <span className="lm-matter-sidebar-list-title">案件</span>
        <span className="lm-matter-sidebar-list-count">{matterRows.length}</span>
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
        <p className="lm-meta lm-matter-sidebar-empty">
          {query.trim() ? "无匹配案件" : "暂无案件，请在 cases/ 目录新建或导入。"}
        </p>
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
