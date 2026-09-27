/**
 * Generic legal-event extractor (summons, court SMS, filing notices, contract expiry).
 * Heuristic only — lawyer confirms before writing deadlines.
 */

export const LEGAL_EVENT_KINDS = [
  "hearing",
  "filing",
  "limitation",
  "reply",
  "preservation",
  "custom",
] as const;

export type LegalEventKind = (typeof LEGAL_EVENT_KINDS)[number];

export const LEGAL_EVENT_KIND_LABELS: Record<LegalEventKind, string> = {
  hearing: "开庭",
  filing: "提交/立案",
  limitation: "时效/期限",
  reply: "答辩/回复",
  preservation: "保全",
  custom: "其他期限",
};

export type ExtractedLegalEvent = {
  eventKind: LegalEventKind;
  title: string;
  dueAt?: string;
  notes?: string;
  confidence: "high" | "medium" | "low";
};

const CN_DATE =
  /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[时点:：](?:\s*(\d{1,2})\s*分)?)?/;
const ISO_DATE = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2}))?/;

function isRealCalendarDate(y: number, m: number, d: number, h: number, min: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || h < 0 || h > 23 || min < 0 || min > 59) {
    return false;
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Wall-clock in China (UTC+8) → UTC instant. Invalid dates (2月31日) stay empty; Date.UTC would roll them. */
function toIso(year: string, month: string, day: string, hour = "09", minute = "00"): string {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const min = Number(minute);
  if (!isRealCalendarDate(y, m, d, h, min)) {
    return "";
  }
  const dt = new Date(Date.UTC(y, m - 1, d, h - 8, min, 0));
  if (Number.isNaN(dt.getTime())) {
    return "";
  }
  return dt.toISOString();
}

type DateHit = { start: number; end: number; iso: string };

function pushDateHit(
  hits: DateHit[],
  start: number,
  end: number,
  year: string,
  month: string,
  day: string,
  hour: string | undefined,
  minute: string | undefined,
): void {
  if (hits.some((hit) => start >= hit.start && start < hit.end)) {
    return;
  }
  const iso = toIso(year, month, day, hour ?? "09", minute ?? "00");
  if (!iso) {
    return;
  }
  hits.push({ start, end, iso });
}

function collectDates(text: string): DateHit[] {
  const hits: DateHit[] = [];
  const cn = new RegExp(CN_DATE.source, "g");
  for (let match = cn.exec(text); match; match = cn.exec(text)) {
    pushDateHit(
      hits,
      match.index,
      match.index + match[0].length,
      match[1] ?? "",
      match[2] ?? "",
      match[3] ?? "",
      match[4],
      match[5],
    );
  }
  const isoRe = new RegExp(ISO_DATE.source, "g");
  for (let match = isoRe.exec(text); match; match = isoRe.exec(text)) {
    const stamp = match[1] ?? "";
    pushDateHit(
      hits,
      match.index,
      match.index + match[0].length,
      stamp.slice(0, 4),
      stamp.slice(5, 7),
      stamp.slice(8, 10),
      match[2],
      match[3],
    );
  }
  return hits;
}

const SENTENCE_BREAKS = new Set(["。", "！", "？", "\n", "；", ";"]);

function sentenceBounds(text: string, at: number): { start: number; end: number } {
  let start = 0;
  for (let i = at; i >= 0; i -= 1) {
    if (SENTENCE_BREAKS.has(text[i] ?? "")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = at; i < text.length; i += 1) {
    if (SENTENCE_BREAKS.has(text[i] ?? "")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/** Closest date in the same sentence as a keyword. Does not borrow the next sentence's date. */
function dateInSentence(text: string, at: number, length: number): string | undefined {
  const bounds = sentenceBounds(text, at);
  const hits = collectDates(text).filter((hit) => hit.end > bounds.start && hit.start < bounds.end);
  if (hits.length === 0) {
    return undefined;
  }
  const dist = (hit: DateHit) => {
    if (hit.end < at) {
      return at - hit.end;
    }
    if (hit.start > at + length) {
      return hit.start - (at + length);
    }
    return 0;
  };
  hits.sort((a, b) => dist(a) - dist(b) || a.start - b.start);
  return hits[0]?.iso;
}

function dateForKeyword(text: string, re: RegExp): string | undefined {
  const global = new RegExp(re.source, "g");
  for (let match = global.exec(text); match; match = global.exec(text)) {
    const word = match[0];
    if (word.includes("开庭") && text[match.index - 1] === "不") {
      continue;
    }
    const due = dateInSentence(text, match.index, word.length);
    if (due) {
      return due;
    }
  }
  return undefined;
}

function keywordAt(text: string, re: RegExp): { index: number; length: number } | null {
  const global = new RegExp(re.source, "g");
  for (let match = global.exec(text); match; match = global.exec(text)) {
    const word = match[0];
    if (word.includes("开庭") && text[match.index - 1] === "不") {
      continue;
    }
    return { index: match.index, length: word.length };
  }
  return null;
}

function pushUnique(out: ExtractedLegalEvent[], ev: ExtractedLegalEvent): void {
  const key = `${ev.eventKind}|${ev.dueAt ?? ""}|${ev.title}`;
  if (out.some((item) => `${item.eventKind}|${item.dueAt ?? ""}|${item.title}` === key)) {
    return;
  }
  out.push(ev);
}

export function extractLegalEvents(text: string): ExtractedLegalEvent[] {
  const raw = text.replace(/\r/g, "").trim();
  if (!raw) {
    return [];
  }
  const out: ExtractedLegalEvent[] = [];
  const dueFor = (re: RegExp): string | undefined => dateForKeyword(raw, re);

  const hearingHit = keywordAt(raw, /传票|开庭通知|开庭|12368/);
  if (hearingHit) {
    const dueAt = dueFor(/传票|开庭通知|开庭|12368/);
    pushUnique(out, {
      eventKind: "hearing",
      title: /谈话/.test(raw) && !/开庭/.test(raw) ? "法院谈话" : "开庭",
      dueAt,
      notes: raw.slice(0, 400),
      confidence: dueAt ? "high" : "medium",
    });
  }
  const replyDue = dueFor(/答辩期|提出答辩|提交答辩状/);
  if (keywordAt(raw, /答辩期|提出答辩|提交答辩状/)) {
    pushUnique(out, {
      eventKind: "reply",
      title: "答辩期限",
      dueAt: replyDue,
      notes: raw.slice(0, 400),
      confidence: replyDue ? "high" : "low",
    });
  }
  const filingDue = dueFor(/举证期限|提交证据/);
  if (keywordAt(raw, /举证期限|提交证据/)) {
    pushUnique(out, {
      eventKind: "filing",
      title: "举证期限",
      dueAt: filingDue,
      notes: raw.slice(0, 400),
      confidence: filingDue ? "high" : "low",
    });
  }
  const limitationDue = dueFor(/上诉期|申请再审|申请执行/);
  if (keywordAt(raw, /上诉期|申请再审|申请执行/)) {
    pushUnique(out, {
      eventKind: "limitation",
      title: /上诉/.test(raw) ? "上诉期限" : "法定期间",
      dueAt: limitationDue,
      notes: raw.slice(0, 400),
      confidence: limitationDue ? "medium" : "low",
    });
  }
  // 保全到期不续封是执业风险：作为期限登记，才能进提醒系统。
  if (keywordAt(raw, /保全|查封|冻结|扣押|续封|续冻|解除保全/)) {
    const action = /续封|续冻/.test(raw)
      ? "保全续封期限"
      : /解除保全/.test(raw)
        ? "解除保全"
        : "保全期限";
    const dueAt = dueFor(/保全|查封|冻结|扣押|续封|续冻|解除保全/);
    pushUnique(out, {
      eventKind: "preservation",
      title: action,
      dueAt,
      notes: raw.slice(0, 400),
      confidence: dueAt ? "medium" : "low",
    });
  }
  if (keywordAt(raw, /续签|到期|届满/) && /合同/.test(raw)) {
    const dueAt = dueFor(/续签|到期|届满/);
    pushUnique(out, {
      eventKind: "custom",
      title: "合同到期",
      dueAt,
      notes: raw.slice(0, 400),
      confidence: dueAt ? "medium" : "low",
    });
  }
  if (out.length === 0 && /法院|案件|案号/.test(raw)) {
    const dueAt = dueFor(/法院|案件|案号/);
    if (dueAt) {
      pushUnique(out, {
        eventKind: "custom",
        title: "案件期限",
        dueAt,
        notes: raw.slice(0, 400),
        confidence: "low",
      });
    }
  }
  return out;
}

export function defaultRemindBeforeHours(kind: LegalEventKind): number {
  if (kind === "hearing") {
    return 72;
  }
  // 保全到期未续封会直接损失担保财产，提前一周提醒。
  if (kind === "preservation") {
    return 168;
  }
  return 24;
}
