/**
 * 工作台「今日提醒」分组与文案（纯函数，可单测）。
 */

import {
  actionSortRank,
  isOverdue,
  type DeskTodayItem,
  type DeskTodayKind,
} from "./lawmind-lawyer-desk-format";

export type DeskAgendaBucketId = "overdue" | "today" | "week" | "memo";

export type DeskAgendaItem = DeskTodayItem & {
  title: string;
  matterId?: string;
  mailLabel?: string;
};

export type DeskAgendaSection = {
  id: DeskAgendaBucketId;
  label: string;
  items: DeskAgendaItem[];
};

const KIND_LABEL: Record<DeskTodayKind, string> = {
  deadline: "期限",
  mail: "来信",
  approval: "拍板",
  plan: "备忘",
};

export function agendaKindLabel(kind: DeskTodayKind, title?: string): string {
  if (kind === "deadline" && title?.includes("开庭")) {
    return "开庭";
  }
  if (kind === "mail" && (title?.includes("法院") || title?.startsWith("法院来件"))) {
    return "法院";
  }
  return KIND_LABEL[kind];
}

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isSameLocalDay(dueAt: string, now: Date): boolean {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  const a = startOfLocalDay(now).getTime();
  const b = startOfLocalDay(due).getTime();
  return a === b;
}

function isWithinLocalDays(dueAt: string, now: Date, days: number): boolean {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  const horizon = startOfLocalDay(now).getTime() + days * 24 * 3600 * 1000;
  return due.getTime() <= horizon;
}

export function agendaBucketFor(
  item: Pick<DeskAgendaItem, "kind" | "dueAt" | "done">,
  now = new Date(),
): DeskAgendaBucketId {
  if (item.dueAt && isOverdue(item.dueAt, now) && !item.done) {
    return "overdue";
  }
  if (item.dueAt && isSameLocalDay(item.dueAt, now)) {
    return "today";
  }
  if (item.dueAt && isWithinLocalDays(item.dueAt, now, 7)) {
    return "week";
  }
  return "memo";
}

const BUCKET_ORDER: DeskAgendaBucketId[] = ["overdue", "today", "week", "memo"];

const BUCKET_LABEL: Record<DeskAgendaBucketId, string> = {
  overdue: "已逾期",
  today: "今天",
  week: "本周",
  memo: "备忘与待办",
};

function sortAgendaItems(items: DeskAgendaItem[], todayDate: string | undefined): DeskAgendaItem[] {
  return items.slice().toSorted((a, b) => {
    if (a.done !== b.done) {
      return a.done ? 1 : -1;
    }
    const rank = actionSortRank(a, todayDate) - actionSortRank(b, todayDate);
    if (rank !== 0) {
      return rank;
    }
    const dueA = a.dueAt ?? "";
    const dueB = b.dueAt ?? "";
    if (dueA !== dueB) {
      return dueA.localeCompare(dueB);
    }
    return a.title.localeCompare(b.title, "zh");
  });
}

/** 把今日快照排成提醒分区；默认隐藏已办完项（办完即从列表消失）。 */
export function buildAgendaSections(
  items: DeskAgendaItem[],
  opts?: { todayDate?: string; now?: Date; includeDone?: boolean },
): DeskAgendaSection[] {
  const now = opts?.now ?? new Date();
  const includeDone = opts?.includeDone === true;
  const buckets = new Map<DeskAgendaBucketId, DeskAgendaItem[]>();
  for (const id of BUCKET_ORDER) {
    buckets.set(id, []);
  }
  for (const item of items) {
    if (!includeDone && item.done) {
      continue;
    }
    buckets.get(agendaBucketFor(item, now))!.push(item);
  }
  return BUCKET_ORDER.map((id) => ({
    id,
    label: BUCKET_LABEL[id],
    items: sortAgendaItems(buckets.get(id) ?? [], opts?.todayDate),
  })).filter((section) => section.items.length > 0);
}

export function agendaProgressLabel(done: number, total: number): string {
  if (total <= 0) {
    return "今天暂无待办";
  }
  if (done >= total) {
    return `今日 ${total} 项已全部办完`;
  }
  return `今日已办 ${done} / ${total}`;
}

/** 对话里「查看 / 打开某某案」类意图（须点名案件/案卷，避免「打开工作台」误跳）。 */
export function isViewMatterIntent(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  return /(?:查看|打开|进入|看看|转到|跳到).{0,12}(?:案件|案卷|卷宗|驾舱)|(?:案件|案卷|卷宗).{0,6}(?:详情|管理|页面)/.test(
    t,
  );
}

/** 提醒来源角标：自动整理 / 手写备忘 / 跨日未结。 */
export function agendaSourceLabel(
  item: Pick<DeskAgendaItem, "kind" | "originDate">,
  todayDate?: string,
): string {
  if (item.kind === "mail" || item.kind === "deadline" || item.kind === "approval") {
    return "自动";
  }
  if (item.originDate && todayDate && item.originDate !== todayDate) {
    return "未结";
  }
  return "手写";
}

export type AgendaMatterGroup = {
  key: string;
  matterId: string | null;
  title: string;
  items: DeskAgendaItem[];
};

/** 分区内按案件归组，便于折叠；无案件归入同一「未关联」组。 */
export function groupAgendaItemsByMatter(
  items: DeskAgendaItem[],
  matterTitleById: Record<string, string>,
): AgendaMatterGroup[] {
  const order: string[] = [];
  const map = new Map<string, AgendaMatterGroup>();
  for (const item of items) {
    const mid = item.matterId?.trim() || null;
    const groupKey = mid ?? "__unlinked__";
    let group = map.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        matterId: mid,
        title: mid ? (matterTitleById[mid] ?? mid) : "未关联案件",
        items: [],
      };
      map.set(groupKey, group);
      order.push(groupKey);
    }
    group.items.push(item);
  }
  return order.map((k) => map.get(k)!);
}

/**
 * 从查看意图解析案件 id：优先绑定芯片，其次标题子串最长匹配。
 */
export function resolveMatterIdFromViewIntent(
  text: string,
  matters: Array<{ matterId: string; title: string }>,
  boundMatterId?: string | null,
): string | null {
  if (!isViewMatterIntent(text)) {
    return null;
  }
  const bound = boundMatterId?.trim();
  if (bound) {
    return bound;
  }
  const t = text.trim().toLowerCase();
  let best: { matterId: string; len: number } | null = null;
  for (const row of matters) {
    const title = row.title.trim();
    if (title.length < 2) {
      continue;
    }
    if (!t.includes(title.toLowerCase())) {
      continue;
    }
    if (!best || title.length > best.len) {
      best = { matterId: row.matterId, len: title.length };
    }
  }
  return best?.matterId ?? null;
}
