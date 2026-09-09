/**
 * Generic legal-event extractor (summons, court SMS, filing notices, contract expiry).
 * Heuristic only — lawyer confirms before writing deadlines.
 */

export const LEGAL_EVENT_KINDS = ["hearing", "filing", "limitation", "reply", "custom"] as const;

export type LegalEventKind = (typeof LEGAL_EVENT_KINDS)[number];

export const LEGAL_EVENT_KIND_LABELS: Record<LegalEventKind, string> = {
  hearing: "开庭",
  filing: "提交/立案",
  limitation: "时效/期限",
  reply: "答辩/回复",
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

function toIso(year: string, month: string, day: string, hour = "09", minute = "00"): string {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const min = Number(minute);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return "";
  }
  const dt = new Date(Date.UTC(y, m - 1, d, h - 8, min, 0));
  if (Number.isNaN(dt.getTime())) {
    return "";
  }
  return dt.toISOString();
}

function firstDate(text: string): string | undefined {
  const cn = CN_DATE.exec(text);
  if (cn) {
    const iso = toIso(cn[1] ?? "", cn[2] ?? "", cn[3] ?? "", cn[4] ?? "09", cn[5] ?? "00");
    return iso || undefined;
  }
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const isoVal = toIso(
      iso[1]?.slice(0, 4) ?? "",
      iso[1]?.slice(5, 7) ?? "",
      iso[1]?.slice(8, 10) ?? "",
      iso[2] ?? "09",
      iso[3] ?? "00",
    );
    return isoVal || undefined;
  }
  return undefined;
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
  const due = firstDate(raw);

  if (/传票|开庭通知|开庭/.test(raw) || /12368/.test(raw)) {
    pushUnique(out, {
      eventKind: "hearing",
      title: /谈话/.test(raw) && !/开庭/.test(raw) ? "法院谈话" : "开庭",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: due ? "high" : "medium",
    });
  }
  if (/答辩期|提出答辩|提交答辩状/.test(raw)) {
    pushUnique(out, {
      eventKind: "reply",
      title: "答辩期限",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: due ? "high" : "low",
    });
  }
  if (/举证期限|提交证据/.test(raw)) {
    pushUnique(out, {
      eventKind: "filing",
      title: "举证期限",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: due ? "high" : "low",
    });
  }
  if (/上诉期|申请再审|申请执行/.test(raw)) {
    pushUnique(out, {
      eventKind: "limitation",
      title: /上诉/.test(raw) ? "上诉期限" : "法定期间",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: due ? "medium" : "low",
    });
  }
  if (/续签|到期|届满/.test(raw) && /合同/.test(raw)) {
    pushUnique(out, {
      eventKind: "custom",
      title: "合同到期",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: due ? "medium" : "low",
    });
  }
  if (out.length === 0 && due && /法院|案件|案号/.test(raw)) {
    pushUnique(out, {
      eventKind: "custom",
      title: "案件期限",
      dueAt: due,
      notes: raw.slice(0, 400),
      confidence: "low",
    });
  }
  return out;
}

export function defaultRemindBeforeHours(kind: LegalEventKind): number {
  return kind === "hearing" ? 72 : 24;
}
