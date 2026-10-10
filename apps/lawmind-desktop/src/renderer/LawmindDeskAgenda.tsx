/**
 * 工作台默认首页：今日提醒（跨案备忘录）。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  agendaKindLabel,
  agendaProgressLabel,
  buildAgendaSections,
  type DeskAgendaItem,
} from "./lawmind-desk-agenda";
import {
  formatClock,
  formatDueShort,
  isOverdue,
  planCardMeta,
  type DeskListFilter,
} from "./lawmind-lawyer-desk-format";
import { DeskGlyph } from "./desk-workbench-bits";
import { LawmindDaemonRecap } from "./LawmindDaemonRecap";

export type LawmindDeskAgendaProps = {
  apiBase: string;
  todayDate?: string;
  items: DeskAgendaItem[];
  progress: { done: number; total: number };
  matterTitleById: Record<string, string>;
  query: string;
  listFilter: DeskListFilter;
  urgencyChips: Array<{ id: Exclude<DeskListFilter, "all">; label: string }>;
  onListFilter: (id: DeskListFilter) => void;
  replicaNote?: ReactNode;
  busy?: boolean;
  onToggleItem: (item: DeskAgendaItem, done: boolean) => void | Promise<void>;
  onOpenMatter: (matterId: string) => void;
  onCreateMatter?: () => void;
  onOpenNeedsDecision?: (matterId?: string) => void;
  onAddPlan: (text: string) => void | Promise<void>;
  onShowCases: () => void;
};

function filterAgendaItems(
  items: DeskAgendaItem[],
  query: string,
  listFilter: DeskListFilter,
  matterTitleById: Record<string, string>,
): DeskAgendaItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (listFilter === "overdue") {
      if (!(item.kind === "deadline" && !item.done && isOverdue(item.dueAt))) {
        return false;
      }
    } else if (listFilter === "unreplied") {
      if (!(item.kind === "mail" && !item.done)) {
        return false;
      }
    } else if (listFilter === "outbound") {
      // 待发出在案卷列表过滤；提醒页保留全部（芯片仍可点进案卷）。
      return true;
    }
    if (!q) {
      return true;
    }
    const matterTitle = item.matterId ? (matterTitleById[item.matterId] ?? item.matterId) : "";
    return (
      item.title.toLowerCase().includes(q) ||
      matterTitle.toLowerCase().includes(q) ||
      agendaKindLabel(item.kind, item.title).includes(query.trim())
    );
  });
}

export function LawmindDeskAgenda(props: LawmindDeskAgendaProps): ReactNode {
  const {
    apiBase,
    todayDate,
    items,
    progress,
    matterTitleById,
    query,
    listFilter,
    urgencyChips,
    onListFilter,
    replicaNote,
    busy,
    onToggleItem,
    onOpenMatter,
    onCreateMatter,
    onOpenNeedsDecision,
    onAddPlan,
    onShowCases,
  } = props;
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; item: DeskAgendaItem } | null>(null);

  const filtered = useMemo(
    () => filterAgendaItems(items, query, listFilter, matterTitleById),
    [items, query, listFilter, matterTitleById],
  );
  const sections = useMemo(
    () => buildAgendaSections(filtered, { todayDate }),
    [filtered, todayDate],
  );
  const openCount = items.filter((i) => !i.done).length;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  const submitPlan = async () => {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setDraft("");
    await onAddPlan(text);
  };

  return (
    <div className="lm-desk-agenda" data-testid="lm-desk-agenda" aria-label="今日提醒">
      <LawmindDaemonRecap apiBase={apiBase} />
      {replicaNote}

      <div className="lm-desk-agenda-hero" data-testid="lm-desk-agenda-hero">
        <div className="lm-desk-agenda-hero-copy">
          <p className="lm-desk-agenda-eyebrow">今日提醒</p>
          <h2>{agendaProgressLabel(progress.done, progress.total)}</h2>
          <p className="lm-desk-agenda-sub">
            {openCount > 0
              ? "按逾期与期日排好。办完勾选，或让 LawMind 办完后自动消失。"
              : "没有紧迫事项时，可手写备忘，或从左栏进入案件管理。"}
          </p>
        </div>
        <div
          className="lm-desk-agenda-ring"
          role="img"
          aria-label={`完成进度 ${pct}%`}
          style={{ ["--agenda-pct" as string]: String(pct) }}
        >
          <span>{pct}%</span>
        </div>
      </div>

      {urgencyChips.length > 0 ? (
        <div className="lm-desk-urgency-strip" data-testid="lm-desk-urgency-strip" aria-label="跨案紧急事项">
          {urgencyChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`lm-desk-urgency-chip${listFilter === chip.id ? " is-active" : ""}`}
              aria-pressed={listFilter === chip.id}
              onClick={() => onListFilter(listFilter === chip.id ? "all" : chip.id)}
            >
              {chip.label}
            </button>
          ))}
          {listFilter === "outbound" ? (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onShowCases}>
              在案卷里看待发出
            </button>
          ) : null}
        </div>
      ) : null}

      {sections.length === 0 ? (
        <div className="lm-lawyer-empty lm-desk-agenda-empty" data-testid="lm-desk-agenda-empty">
          <span className="lm-desk-ico" aria-hidden>
            <DeskGlyph name="folder" />
          </span>
          <p className="lm-lawyer-empty-title">
            {listFilter === "all" && !query.trim() ? "今天很清静" : "没有匹配的提醒"}
          </p>
          <p>
            {listFilter === "all" && !query.trim()
              ? "开庭、期限、待回邮件会自动出现在这里。也可先记一条备忘。"
              : "换一个筛选，或清除搜索。"}
          </p>
          <div className="lm-desk-agenda-empty-actions">
            {listFilter !== "all" ? (
              <button type="button" className="lm-btn lm-btn-sm" onClick={() => onListFilter("all")}>
                全部提醒
              </button>
            ) : null}
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onShowCases}>
              浏览案卷
            </button>
            {onCreateMatter ? (
              <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                新建案件
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="lm-desk-agenda-sections">
          {sections.map((section) => (
            <section
              key={section.id}
              className={`lm-desk-agenda-section lm-desk-agenda-section--${section.id}`}
              aria-labelledby={`lm-agenda-${section.id}`}
            >
              <header className="lm-desk-agenda-section-head">
                <h3 id={`lm-agenda-${section.id}`}>{section.label}</h3>
                <span className="lm-desk-agenda-count">{section.items.length}</span>
              </header>
              <ul className="lm-desk-agenda-list">
                {section.items.map((item) => {
                  const matterTitle = item.matterId
                    ? (matterTitleById[item.matterId] ?? item.matterId)
                    : null;
                  const kind = agendaKindLabel(item.kind, item.title);
                  const canCheck = item.kind !== "approval";
                  const meta =
                    item.kind === "plan"
                      ? planCardMeta(item, todayDate)
                      : item.dueAt
                        ? `${isOverdue(item.dueAt) && !item.done ? "已过 · " : ""}${formatDueShort(item.dueAt) || formatClock(item.dueAt)}`
                        : item.kind === "approval"
                          ? "去「在办」拍板"
                          : "";
                  return (
                    <li key={item.id}>
                      <article
                        className={`lm-desk-agenda-card${item.done ? " is-done" : ""}${
                          section.id === "overdue" && !item.done ? " is-hot" : ""
                        }`}
                        data-testid={`lm-lawyer-today-item-${item.kind}`}
                        data-agenda-kind={item.kind}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, item });
                        }}
                      >
                        <label className="lm-desk-agenda-check">
                          <input
                            type="checkbox"
                            checked={item.done}
                            disabled={busy || !canCheck}
                            aria-label={item.done ? `取消完成：${item.title}` : `完成：${item.title}`}
                            onChange={(e) => void onToggleItem(item, e.target.checked)}
                          />
                        </label>
                        <div className="lm-desk-agenda-card-body">
                          <div className="lm-desk-agenda-card-top">
                            <span className="lm-desk-agenda-kind" data-kind={item.kind}>
                              {kind}
                            </span>
                            <strong className="lm-desk-agenda-title">{item.title}</strong>
                          </div>
                          <div className="lm-desk-agenda-card-meta">
                            {meta ? <span className="lm-lawyer-today-meta">{meta}</span> : null}
                            {matterTitle ? (
                              <button
                                type="button"
                                className="lm-desk-agenda-matter-link"
                                data-testid="lm-desk-agenda-open-matter"
                                onClick={() => onOpenMatter(item.matterId!)}
                              >
                                {matterTitle}
                              </button>
                            ) : (
                              <span className="lm-lawyer-today-meta">未关联案件</span>
                            )}
                          </div>
                        </div>
                        <div className="lm-desk-agenda-card-actions">
                          {item.kind === "approval" && onOpenNeedsDecision ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-sm"
                              onClick={() => onOpenNeedsDecision(item.matterId)}
                            >
                              去拍板
                            </button>
                          ) : null}
                          {item.matterId ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              onClick={() => onOpenMatter(item.matterId!)}
                            >
                              案件管理
                            </button>
                          ) : onCreateMatter ? (
                            <button
                              type="button"
                              className="lm-btn lm-btn-ghost lm-btn-sm"
                              data-testid="lm-desk-agenda-create-matter"
                              onClick={onCreateMatter}
                            >
                              新建案件
                            </button>
                          ) : null}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <form
        className="lm-desk-agenda-compose"
        data-testid="lm-desk-agenda-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void submitPlan();
        }}
      >
        <input
          className="lm-input"
          data-testid="lm-lawyer-today-plan-input"
          value={draft}
          disabled={busy}
          placeholder="记一条提醒，例如：周五前回王总电话…"
          aria-label="添加今日提醒"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="lm-btn lm-btn-sm" disabled={busy || !draft.trim()}>
          添加
        </button>
      </form>

      {menu ? (
        <div
          className="lm-context-menu lm-desk-agenda-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          data-testid="lm-desk-agenda-context-menu"
        >
          {menu.item.matterId ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenMatter(menu.item.matterId!);
                setMenu(null);
              }}
            >
              进入案件管理
            </button>
          ) : onCreateMatter ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCreateMatter();
                setMenu(null);
              }}
            >
              新建案件并挂上
            </button>
          ) : null}
          {menu.item.kind === "approval" && onOpenNeedsDecision ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onOpenNeedsDecision(menu.item.matterId);
                setMenu(null);
              }}
            >
              去「在办」拍板
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => setMenu(null)}>
            取消
          </button>
        </div>
      ) : null}
      {menu ? (
        <button
          type="button"
          className="lm-desk-agenda-menu-backdrop"
          aria-label="关闭菜单"
          onClick={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
