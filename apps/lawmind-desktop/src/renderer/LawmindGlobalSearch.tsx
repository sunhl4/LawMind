/**
 * ⌘K 全局查找：一个框搜案件、期限、来信、待发出、对话，回车直达档案页锚点。
 * 数据全在本机（desk / sessions / action-summary），打开时并取、客户端子串过滤；
 * 取不到的数据组安静缺席，命令区照常可用——搜索永远不挡干活。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";
import { loadActionSummary } from "./lawmind-requires-action";
import { pendingOutboundItems } from "./lawmind-desk-outbound";
import { requestOpenChatSession } from "./lawmind-open-chat-session-bus";
import { LAWMIND_CANVAS_COMPOSER_EVENT } from "./canvas/host-actions";
import type { CommandPaletteAction } from "./LawmindCommandPalette";
import type { DeskMatterFocusPane } from "./app/desk-matter-focus";

type SearchSectionId = "matters" | "deadlines" | "mail" | "outbound" | "chats" | "commands";

const SECTION_ORDER: SearchSectionId[] = [
  "matters",
  "deadlines",
  "mail",
  "outbound",
  "chats",
  "commands",
];

const SECTION_LABELS: Record<SearchSectionId, string> = {
  matters: "案件",
  deadlines: "期限",
  mail: "来信",
  outbound: "待发出",
  chats: "对话",
  commands: "命令",
};

/** 空查询时各组最多露几条：先给「最近在用的」，不让列表变卡墙。 */
const EMPTY_QUERY_CAPS: Record<SearchSectionId, number> = {
  matters: 5,
  deadlines: 0,
  mail: 0,
  outbound: 3,
  chats: 5,
  commands: 100,
};

const QUERY_SECTION_CAPS: Record<SearchSectionId, number> = {
  matters: 8,
  deadlines: 6,
  mail: 6,
  outbound: 6,
  chats: 8,
  commands: 100,
};

type SearchEntry = {
  id: string;
  section: SearchSectionId;
  label: string;
  hint?: string;
  /** 同组内按这个倒序排（recency）；没带的按原序沉后面。 */
  at?: string;
  run: () => void;
};

type PaletteRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "entry"; key: string; entry: SearchEntry };

type DeskMattersResponse = {
  ok?: boolean;
  matters?: Array<{
    matterId: string;
    title: string;
    docket?: { caseNo?: string; court?: string };
  }>;
};

type TodayResponse = {
  ok?: boolean;
  today?: {
    items?: Array<{
      id: string;
      kind: string;
      title: string;
      done: boolean;
      matterId?: string;
      dueAt?: string;
    }>;
  };
};

type SessionsResponse = {
  ok?: boolean;
  sessions?: Array<{
    sessionId: string;
    title: string;
    matterId?: string | null;
    assistantId?: string | null;
    updatedAt?: string;
    lastPreview?: string;
  }>;
};

function firstEntryIndex(rows: PaletteRow[]): number {
  return rows.findIndex((row) => row.kind === "entry");
}

function composingKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

type Props = {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  /** 命令区（根壳级：切工作面、新建案件、设置）。 */
  actions: CommandPaletteAction[];
  /** 案件跳进档案页；pane 决定滚到「现在 / 卷 / 期限」。 */
  onOpenMatterDossier: (matterId: string, pane?: DeskMatterFocusPane) => void;
};

function matches(query: string, entry: SearchEntry): boolean {
  if (entry.label.toLowerCase().includes(query)) {
    return true;
  }
  return Boolean(entry.hint && entry.hint.toLowerCase().includes(query));
}

function shortDue(dueAt: string | undefined): string | undefined {
  const stamp = dueAt?.trim();
  if (!stamp) {
    return undefined;
  }
  return stamp.slice(0, 10);
}

export function LawmindGlobalSearch({
  open,
  onClose,
  apiBase,
  actions,
  onOpenMatterDossier,
}: Props): ReactNode {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remote, setRemote] = useState<{
    loaded: boolean;
    matters: DeskMattersResponse["matters"];
    todayItems: NonNullable<TodayResponse["today"]>["items"];
    outbound: ReturnType<typeof pendingOutboundItems>;
    sessions: SessionsResponse["sessions"];
  }>({ loaded: false, matters: [], todayItems: [], outbound: [], sessions: [] });
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setQuery("");
    setActiveIndex(0);
    let cancelled = false;
    // 打开时并取四路本机数据；任何一路失败都只少一组，不报错。
    void Promise.all([
      apiGetJson<DeskMattersResponse>(apiBase, "/api/desk/matters").catch(() => null),
      apiGetJson<TodayResponse>(apiBase, "/api/desk/today").catch(() => null),
      loadActionSummary(apiBase).catch(() => null),
      apiGetJson<SessionsResponse>(apiBase, "/api/sessions").catch(() => null),
    ]).then(([matters, today, summary, sessions]) => {
      if (cancelled) {
        return;
      }
      setRemote({
        loaded: true,
        matters: matters?.matters ?? [],
        todayItems: today?.today?.items ?? [],
        outbound: summary ? pendingOutboundItems(summary) : [],
        sessions: sessions?.sessions ?? [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase]);

  const entries = useMemo((): SearchEntry[] => {
    const commandEntries: SearchEntry[] = actions.map((action) => ({
      id: `cmd:${action.id}`,
      section: "commands",
      label: action.label,
      hint: action.hint ?? action.slash,
      run: action.run,
    }));
    if (!open) {
      return commandEntries;
    }
    const matterEntries: SearchEntry[] = (remote.matters ?? []).map((row) => ({
      id: `matter:${row.matterId}`,
      section: "matters",
      label: row.title,
      hint: [row.docket?.caseNo, row.docket?.court].filter(Boolean).join(" · ") || undefined,
      run: () => onOpenMatterDossier(row.matterId),
    }));
    const todayItems = remote.todayItems ?? [];
    const deadlineEntries: SearchEntry[] = todayItems
      .filter((item) => item.kind === "deadline" && !item.done && item.matterId?.trim())
      .map((item) => ({
        id: `deadline:${item.id}`,
        section: "deadlines",
        label: item.title,
        hint: shortDue(item.dueAt),
        at: item.dueAt,
        run: () => onOpenMatterDossier(item.matterId as string, "deadlines"),
      }));
    const mailEntries: SearchEntry[] = todayItems
      .filter((item) => item.kind === "mail" && !item.done && item.matterId?.trim())
      .map((item) => ({
        id: `mail:${item.id}`,
        section: "mail",
        label: item.title,
        hint: "未回",
        at: item.dueAt,
        run: () => onOpenMatterDossier(item.matterId as string, "docs"),
      }));
    const outboundEntries: SearchEntry[] = (remote.outbound ?? []).map((item) => ({
      id: `outbound:${item.id}`,
      section: "outbound",
      label: item.subject || item.title,
      hint: item.to,
      run: () => onOpenMatterDossier(item.matterId, "docs"),
    }));
    const chatEntries: SearchEntry[] = (remote.sessions ?? [])
      .map((session) => ({
        id: `chat:${session.sessionId}`,
        section: "chats" as const,
        label: session.title,
        hint: session.lastPreview,
        at: session.updatedAt,
        run: () =>
          requestOpenChatSession({
            sessionId: session.sessionId,
            title: session.title,
            matterId: session.matterId ?? undefined,
            assistantId: session.assistantId ?? undefined,
          }),
      }))
      .toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    return [...matterEntries, ...deadlineEntries, ...mailEntries, ...outboundEntries, ...chatEntries, ...commandEntries];
  }, [actions, open, remote, onOpenMatterDossier]);

  const rows = useMemo((): PaletteRow[] => {
    const q = query.trim().toLowerCase();
    const out: PaletteRow[] = [];
    for (const section of SECTION_ORDER) {
      const sectionEntries = entries.filter((entry) => entry.section === section);
      const filtered = q
        ? sectionEntries.filter((entry) => matches(q, entry)).slice(0, QUERY_SECTION_CAPS[section])
        : sectionEntries
            .toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
            .slice(0, EMPTY_QUERY_CAPS[section]);
      if (filtered.length === 0) {
        continue;
      }
      out.push({ kind: "header", key: `h:${section}`, label: SECTION_LABELS[section] });
      for (const entry of filtered) {
        out.push({ kind: "entry", key: entry.id, entry });
      }
    }
    return out;
  }, [entries, query]);

  const entryIndices = useMemo(
    () => rows.map((row, i) => (row.kind === "entry" ? i : -1)).filter((i) => i >= 0),
    [rows],
  );

  const selectionReset = useRef({ query, open });

  useEffect(() => {
    const first = firstEntryIndex(rows);
    const shouldReset =
      selectionReset.current.query !== query || selectionReset.current.open !== open;
    selectionReset.current = { query, open };
    setActiveIndex((i) => {
      if (!shouldReset && rows[i]?.kind === "entry") {
        return i;
      }
      return first >= 0 ? first : 0;
    });
  }, [query, open, rows]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (composingKey(e)) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => {
          const next = entryIndices.find((idx) => idx > i);
          return next ?? i;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => {
          const prev = entryIndices.toReversed().find((idx) => idx < i);
          return prev ?? i;
        });
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = rows[activeIndex];
        if (row?.kind === "entry") {
          row.entry.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, rows, entryIndices, activeIndex, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const node = listRef.current?.querySelector(".lm-command-palette-item-active");
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows]);

  if (!open) {
    return null;
  }

  const hasEntries = entryIndices.length > 0;
  const activeEntryId =
    rows[activeIndex]?.kind === "entry" ? `lm-gs-${rows[activeIndex].entry.id}` : undefined;

  const askInChat = () => {
    const prompt = query.trim();
    window.dispatchEvent(
      new CustomEvent(LAWMIND_CANVAS_COMPOSER_EVENT, {
        detail: { prompt: prompt ? `帮我找：${prompt}` : "" },
      }),
    );
    onClose();
  };

  return (
    <div className="lm-command-palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lm-command-palette lm-command-palette-wide"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
        data-testid="lm-global-search"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="lm-input lm-command-palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索案件、期限、来信、待发出、对话…"
          autoFocus
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="lm-global-search-list"
          aria-activedescendant={activeEntryId}
          aria-label="全局搜索"
        />
        <ul
          className="lm-command-palette-list"
          ref={listRef}
          id="lm-global-search-list"
          role="listbox"
        >
          {rows.map((row, i) =>
            row.kind === "header" ? (
              <li key={row.key} className="lm-command-palette-section" role="presentation">
                {row.label}
              </li>
            ) : (
              <li key={row.key} role="presentation">
                <button
                  type="button"
                  id={`lm-gs-${row.entry.id}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`lm-command-palette-item${i === activeIndex ? " lm-command-palette-item-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => {
                    row.entry.run();
                    onClose();
                  }}
                >
                  <span className="lm-command-palette-label">{row.entry.label}</span>
                  {row.entry.hint ? <span className="lm-meta">{row.entry.hint}</span> : null}
                </button>
              </li>
            ),
          )}
        </ul>
        {hasEntries ? null : (
          <div className="lm-global-search-empty">
            <p className="lm-meta">{remote.loaded ? "没有匹配的结果。" : "正在读本机案卷…"}</p>
            <button type="button" className="lm-btn lm-btn-sm" onClick={askInChat}>
              在对话里问
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
