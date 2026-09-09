/**
 * Parse Chinese / ISO calendar dates from lawyer instructions.
 * Never invent a day; incomplete 年/月 without 日 is skipped for period math.
 */

const YMD = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toYmd(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return undefined;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseFirstYmd(text: string): string | undefined {
  const m = YMD.exec(text);
  if (!m) {
    return undefined;
  }
  return toYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

export type DatedSnippet = {
  ymd: string;
  raw: string;
  fact: string;
};

export function extractDatedSnippets(text: string, max = 12): DatedSnippet[] {
  const out: DatedSnippet[] = [];
  const seen = new Set<string>();
  const re = new RegExp(YMD.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && out.length < max) {
    const ymd = toYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!ymd || seen.has(`${ymd}:${m.index}`)) {
      continue;
    }
    seen.add(`${ymd}:${m.index}`);
    const start = Math.max(0, m.index - 8);
    const end = Math.min(text.length, m.index + m[0].length + 24);
    const fact = text
      .slice(start, end)
      .replace(m[0], "")
      .replace(/^[，。,.\s：:]+|[，。,.\s]+$/g, "")
      .slice(0, 40);
    out.push({ ymd, raw: m[0].replace(/\s+/g, ""), fact: fact || "【待补充】事件" });
  }
  return out;
}
