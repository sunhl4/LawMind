/**
 * 工作台默认首页：今日提醒（跨案备忘录）。
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  agendaKindLabel,
  agendaProgressLabel,
  agendaSourceLabel,
  buildAgendaSections,
  groupAgendaItemsByMatter,
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
  /** 空态快捷入口：最近/最热案件 */
  recentMatters?: Array<{ matterId: string; title: string }>;
  /** 对话已绑案件时，可「只看本案」 */
  focusMatterId?: string | null;
  query: string;
  listFilter: DeskListFilter;
  urgencyChips: Array<{ id: Exclude<DeskListFilter, "all">; label: string }>;
  onListFilter: (id: DeskListFilter) => void;
  replicaNote?: ReactNode;
  busy?: boolean;
  /** 办完后从列表消失 */
  onCompleteItem: (item: DeskAgendaItem) => void | Promise<void>;
  /** 手写备忘：过时项可直接删除 */
  onDeleteItem: (item: DeskAgendaItem) => void | Promise<void>;
  /** 恢复误办完的提醒（备忘 / 邮件） */
  onRestoreItem?: (item: DeskAgendaItem) => void | Promise<void>;
  onOpenMatter: (matterId: string) => void;
  onCreateMatter?: () => void;
  /** 手写备忘：建案成功后挂上该提醒 */
  onCreateMatterForItem?: (item: DeskAgendaItem) => void;
  onOpenNeedsDecision?: (matterId?: string) => void;
  onAddPlan: (text: string) => void | Promise<void>;
  onShowCases: () => void;
  onGoToChat?: (opts?: { prompt?: string }) => void;
};

function filterAgendaItems(
  items: DeskAgendaItem[],
  query: string,
  listFilter: DeskListFilter,
  matterTitleById: Record<string, string>,
  focusMatterId?: string | null,
): DeskAgendaItem[] {
  const q = query.trim().toLowerCase();
  const focus = focusMatterId?.trim() || null;
  return items.filter((item) => {
    if (focus && item.matterId !== focus) {
      return false;
    }
    if (listFilter === "overdue") {
      if (!(item.kind === "deadline" && !item.done && isOverdue(item.dueAt))) {
        return false;
      }
    } else if (listFilter === "unreplied") {
      if (!(item.kind === "mail" && !item.done)) {
        return false;
      }
    } else if (listFilter === "outbound") {
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
    recentMatters = [],
    focusMatterId = null,
    query,
    listFilter,
    urgencyChips,
    onListFilter,
    replicaNote,
    busy,
    onCompleteItem,
    onDeleteItem,
    onRestoreItem,
    onOpenMatter,
    onCreateMatter,
    onCreateMatterForItem,
    onOpenNeedsDecision,
    onAddPlan,
    onShowCases,
    onGoToChat,
  } = props;
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; item: DeskAgendaItem } | null>(null);
  const [onlyFocusMatter, setOnlyFocusMatter] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  const focusFilter = onlyFocusMatter ? focusMatterId : null;
  const filtered = useMemo(
    () => filterAgendaItems(items, query, listFilter, matterTitleById, focusFilter),
    [items, query, listFilter, matterTitleById, focusFilter],
  );
  const sections = useMemo(
    () => buildAgendaSections(filtered, { todayDate }),
    [filtered, todayDate],
  );
  const doneItems = useMemo(
    () => filtered.filter((item) => item.done && (item.kind === "plan" || item.kind === "mail")),
    [filtered],
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

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderItemCard = (item: DeskAgendaItem, sectionId: string) => {
    const matterTitle = item.matterId ? (matterTitleById[item.matterId] ?? item.matterId) : null;
    const kind = agendaKindLabel(item.kind, item.title);
    const source = agendaSourceLabel(item, todayDate);
    const canComplete = item.kind === "plan" || item.kind === "mail" || item.kind === "deadline";
    const canDelete = item.kind === "plan";
    const canLinkCreate = item.kind === "plan" && !item.matterId && Boolean(onCreateMatterForItem);
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
          className={`lm-desk-agenda-card${sectionId === "overdue" && !item.done ? " is-hot" : ""}`}
          data-testid={`lm-lawyer-today-item-${item.kind}`}
          data-agenda-kind={item.kind}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, item });
          }}
        >
          <div className="lm-desk-agenda-card-body">
            <div className="lm-desk-agenda-card-top">
              <span className="lm-desk-agenda-kind" data-kind={item.kind}>
                {kind}
              </span>
              <span className="lm-desk-agenda-source" data-source={source}>
                {source}
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
            {canComplete ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                data-testid="lm-desk-agenda-complete"
                disabled={busy}
                onClick={() => void onCompleteItem(item)}
              >
                办完
              </button>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-desk-agenda-delete"
                disabled={busy}
                onClick={() => void onDeleteItem(item)}
              >
                删除
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
            ) : canLinkCreate ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-desk-agenda-create-matter"
                onClick={() => onCreateMatterForItem?.(item)}
              >
                新建并挂上
              </button>
            ) : onCreateMatter ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={onCreateMatter}
              >
                新建案件
              </button>
            ) : null}
          </div>
        </article>
      </li>
    );
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
              ? "按逾期与期日排好。点「办完」后消失；过时备忘可「删除」。"
              : "没有紧迫事项时，可手写备忘，或从对话说「记一下…」。"}
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

      {urgencyChips.length > 0 || focusMatterId?.trim() ? (
        <div className="lm-desk-urgency-strip" data-testid="lm-desk-urgency-strip" aria-label="筛选">
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
          {focusMatterId?.trim() ? (
            <button
              type="button"
              className={`lm-desk-urgency-chip${onlyFocusMatter ? " is-active" : ""}`}
              aria-pressed={onlyFocusMatter}
              data-testid="lm-desk-agenda-focus-matter"
              onClick={() => setOnlyFocusMatter((v) => !v)}
            >
              只看本案
            </button>
          ) : null}
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
            {listFilter === "all" && !query.trim() && !onlyFocusMatter
              ? "今天很清静"
              : "没有匹配的提醒"}
          </p>
          <p>
            {listFilter === "all" && !query.trim() && !onlyFocusMatter
              ? "开庭、期限、待回邮件会自动出现。也可在下方记一条，或对对话说「记一下周五回电」。"
              : "换一个筛选，或清除搜索。"}
          </p>
          {recentMatters.length > 0 && listFilter === "all" && !query.trim() && !onlyFocusMatter ? (
            <div className="lm-desk-agenda-recent" data-testid="lm-desk-agenda-recent">
              <p className="lm-desk-agenda-recent-label">最近案件</p>
              <ul>
                {recentMatters.map((row) => (
                  <li key={row.matterId}>
                    <button
                      type="button"
                      className="lm-desk-agenda-recent-btn"
                      onClick={() => onOpenMatter(row.matterId)}
                    >
                      {row.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="lm-desk-agenda-empty-actions">
            {listFilter !== "all" || onlyFocusMatter ? (
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                onClick={() => {
                  onListFilter("all");
                  setOnlyFocusMatter(false);
                }}
              >
                全部提醒
              </button>
            ) : null}
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onShowCases}>
              浏览案卷
            </button>
            {onGoToChat ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={() => onGoToChat({ prompt: "记一下：" })}
              >
                在对话里记一条
              </button>
            ) : null}
            {onCreateMatter ? (
              <button type="button" className="lm-btn lm-btn-sm" onClick={onCreateMatter}>
                新建案件
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="lm-desk-agenda-sections">
          {sections.map((section) => {
            const groups = groupAgendaItemsByMatter(section.items, matterTitleById);
            const useGroups = groups.length > 1 || Boolean(groups[0]?.matterId);
            return (
              <section
                key={section.id}
                className={`lm-desk-agenda-section lm-desk-agenda-section--${section.id}`}
                aria-labelledby={`lm-agenda-${section.id}`}
              >
                <header className="lm-desk-agenda-section-head">
                  <h3 id={`lm-agenda-${section.id}`}>{section.label}</h3>
                  <span className="lm-desk-agenda-count">{section.items.length}</span>
                </header>
                {useGroups ? (
                  <div className="lm-desk-agenda-groups">
                    {groups.map((group) => {
                      const collapsed = collapsedGroups.has(`${section.id}:${group.key}`);
                      return (
                        <div
                          key={group.key}
                          className="lm-desk-agenda-group"
                          data-testid="lm-desk-agenda-group"
                        >
                          <button
                            type="button"
                            className="lm-desk-agenda-group-head"
                            aria-expanded={!collapsed}
                            onClick={() => toggleGroup(`${section.id}:${group.key}`)}
                          >
                            <span className="lm-desk-agenda-group-chev" aria-hidden>
                              {collapsed ? "▸" : "▾"}
                            </span>
                            <span className="lm-desk-agenda-group-title">{group.title}</span>
                            <span className="lm-desk-agenda-count">{group.items.length}</span>
                          </button>
                          {!collapsed ? (
                            <ul className="lm-desk-agenda-list">
                              {group.items.map((item) => renderItemCard(item, section.id))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="lm-desk-agenda-list">
                    {section.items.map((item) => renderItemCard(item, section.id))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {doneItems.length > 0 && onRestoreItem ? (
        <details className="lm-desk-agenda-done" data-testid="lm-desk-agenda-done">
          <summary>
            已办完 · {doneItems.length}
            <span className="lm-desk-agenda-done-hint">误消的案件提醒可在此恢复</span>
          </summary>
          <ul className="lm-desk-agenda-list">
            {doneItems.map((item) => {
              const matterTitle = item.matterId
                ? (matterTitleById[item.matterId] ?? item.matterId)
                : null;
              return (
                <li key={`done-${item.id}`}>
                  <article className="lm-desk-agenda-card lm-desk-agenda-card--done-row">
                    <div className="lm-desk-agenda-card-body">
                      <div className="lm-desk-agenda-card-top">
                        <span className="lm-desk-agenda-kind" data-kind={item.kind}>
                          {agendaKindLabel(item.kind, item.title)}
                        </span>
                        <strong className="lm-desk-agenda-title">{item.title}</strong>
                      </div>
                      {matterTitle ? (
                        <div className="lm-desk-agenda-card-meta">
                          <span className="lm-lawyer-today-meta">{matterTitle}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="lm-desk-agenda-card-actions">
                      <button
                        type="button"
                        className="lm-btn lm-btn-sm"
                        data-testid="lm-desk-agenda-restore"
                        disabled={busy}
                        onClick={() => void onRestoreItem(item)}
                      >
                        恢复
                      </button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

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
          {menu.item.kind === "plan" || menu.item.kind === "mail" || menu.item.kind === "deadline" ? (
            <button
              type="button"
              role="menuitem"
              data-testid="lm-desk-agenda-menu-complete"
              onClick={() => {
                void onCompleteItem(menu.item);
                setMenu(null);
              }}
            >
              办完
            </button>
          ) : null}
          {menu.item.kind === "plan" ? (
            <button
              type="button"
              role="menuitem"
              data-testid="lm-desk-agenda-menu-delete"
              onClick={() => {
                void onDeleteItem(menu.item);
                setMenu(null);
              }}
            >
              删除提醒
            </button>
          ) : null}
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
          ) : menu.item.kind === "plan" && onCreateMatterForItem ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCreateMatterForItem(menu.item);
                setMenu(null);
              }}
            >
              新建案件并挂上
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
              新建案件
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
