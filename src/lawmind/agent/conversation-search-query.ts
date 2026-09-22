/**
 * Browser-safe conversation search query parsing (no node:fs / path).
 * Engine scan/read lives in `conversation-search.ts`.
 */

export type ConversationTimeWindow = {
  sinceMs: number;
  untilMs: number;
  label: string;
};

export type RelativeKind =
  | "today"
  | "yesterday"
  | "day_before_yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "last_year";

export type ParsedConversationQuery = {
  keywords: string[];
  phrases: string[];
  relative?: { kind: RelativeKind; matched: string };
};

const STOP = new Set([
  "的",
  "了",
  "和",
  "与",
  "及",
  "或",
  "在",
  "是",
  "请",
  "帮",
  "我",
  "一份",
  "这个",
  "那个",
  "进行",
  "相关",
  "关于",
  "一下",
  "对话",
  "聊天",
  "会话",
  "讲的",
  "说的",
  "上次",
  "之前",
  "要点",
  "做法",
  "内容",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "in",
  "to",
  "for",
]);

const RELATIVE_PATTERNS: Array<{ kind: RelativeKind; re: RegExp }> = [
  { kind: "day_before_yesterday", re: /前天/ },
  { kind: "yesterday", re: /昨天|昨日/ },
  { kind: "today", re: /今天|今日/ },
  { kind: "last_week", re: /上周|上星期|上週/ },
  { kind: "this_week", re: /本周|这周|這週|本星期/ },
  { kind: "last_month", re: /上个月|上月/ },
  { kind: "this_month", re: /本月|这个月|這個月/ },
  { kind: "last_year", re: /去年/ },
];

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeekMonday(d: Date): Date {
  const day = startOfLocalDay(d);
  const wd = day.getDay();
  const diff = wd === 0 ? -6 : 1 - wd;
  day.setDate(day.getDate() + diff);
  return day;
}

export function resolveRelativeTimeWindow(
  kind: RelativeKind,
  nowMs: number,
): ConversationTimeWindow {
  const now = new Date(nowMs);
  if (kind === "today") {
    const since = startOfLocalDay(now);
    return { sinceMs: since.getTime(), untilMs: nowMs, label: "today" };
  }
  if (kind === "yesterday") {
    const end = startOfLocalDay(now);
    const since = new Date(end);
    since.setDate(since.getDate() - 1);
    return { sinceMs: since.getTime(), untilMs: end.getTime() - 1, label: "yesterday" };
  }
  if (kind === "day_before_yesterday") {
    const y = startOfLocalDay(now);
    y.setDate(y.getDate() - 1);
    const since = new Date(y);
    since.setDate(since.getDate() - 1);
    return { sinceMs: since.getTime(), untilMs: y.getTime() - 1, label: "day_before_yesterday" };
  }
  if (kind === "this_week") {
    const since = startOfWeekMonday(now);
    return { sinceMs: since.getTime(), untilMs: nowMs, label: "this_week" };
  }
  if (kind === "last_week") {
    const thisMon = startOfWeekMonday(now);
    const since = new Date(thisMon);
    since.setDate(since.getDate() - 7);
    return { sinceMs: since.getTime(), untilMs: thisMon.getTime() - 1, label: "last_week" };
  }
  if (kind === "this_month") {
    const since = new Date(now.getFullYear(), now.getMonth(), 1);
    return { sinceMs: since.getTime(), untilMs: nowMs, label: "this_month" };
  }
  if (kind === "last_month") {
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const since = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { sinceMs: since.getTime(), untilMs: thisMonth.getTime() - 1, label: "last_month" };
  }
  const thisYear = new Date(now.getFullYear(), 0, 1);
  const since = new Date(now.getFullYear() - 1, 0, 1);
  return { sinceMs: since.getTime(), untilMs: thisYear.getTime() - 1, label: "last_year" };
}

export function parseConversationSearchQuery(raw: string): ParsedConversationQuery {
  let rest = raw.replace(/^\uFEFF/, "").trim();
  let relative: ParsedConversationQuery["relative"];
  for (const row of RELATIVE_PATTERNS) {
    const m = row.re.exec(rest);
    if (!m) {
      continue;
    }
    relative = { kind: row.kind, matched: m[0] };
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`.trim();
    break;
  }

  const phrases: string[] = [];
  rest = rest.replace(/"([^"]+)"|「([^」]+)」|『([^』]+)』/g, (_all, a, b, c) => {
    const p = String(a ?? b ?? c ?? "")
      .trim()
      .toLowerCase();
    if (p.length >= 2) {
      phrases.push(p);
    }
    return " ";
  });

  const keywords: string[] = [];
  const pieces = rest.split(/\s+|的|了|和|与|及|那个|这个|一下|相关|关于|讲的|说的/);
  for (const part of pieces) {
    const t = part.trim().toLowerCase();
    if (t.length < 2 || STOP.has(t)) {
      continue;
    }
    keywords.push(t);
  }
  const unique = [...new Set(keywords)];
  const capped =
    unique.length <= 3
      ? unique
      : [...unique].toSorted((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 3);
  return { keywords: capped, phrases: [...new Set(phrases)], relative };
}
