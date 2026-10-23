/**
 * Playbook structure extraction.
 *
 * Scope discipline: this module extracts STRUCTURE (tier, id, section, the
 * numbers a line states) and says so honestly when a line is prose that a
 * machine cannot turn into a criterion. It does not invent questions and it
 * does not guess thresholds (GOALS.md 铁律 5: no hard control pretending to be
 * judgement). Turning a constraint into a `RuleCriterion` stays with the model
 * or the lawyer; this layer says what is machine-reachable and what is not.
 *
 * Why the split: three real firm playbooks were inspected (LawMind-Bench
 * `private/contract-review/*`). They use three different formats — ID-prefixed
 * one-liners, tiered numbered lists, and sectioned prose. A single regex cannot
 * cover all three, and pretending otherwise would silently drop red lines.
 */

/** What a playbook line demands of the contract. */
export type PlaybookTier = "must_not" | "should_trade" | "advisory";

export type PlaybookLine = {
  /** 1-based line number in the source file. */
  line: number;
  /** Trimmed original text. Never rewritten. */
  raw: string;
  /** Stable id from the playbook (e.g. `RL-L1`), when present. */
  id?: string;
  /** Section heading the line sits under, when any. */
  section?: string;
  tier?: PlaybookTier;
  /** Thresholds quoted verbatim; the engine never re-derives these. */
  numbers: string[];
  /**
   * `structured`: tier/id/section recovered mechanically.
   * `prose`: a red-line-shaped sentence without machine-readable tier; a model
   * or lawyer must author the criterion.
   */
  status: "structured" | "prose";
};

export type PlaybookExtract = {
  source: string;
  lines: PlaybookLine[];
  structured: number;
  prose: number;
  /** Lines that looked like content but carry no machine-readable constraint. */
  skipped: number;
};

/** `RL-L1`, `RL-3`, `CONTRACT-12`: an explicit red-line identifier. */
const ID_PREFIX_RE = /^([A-Z]{2,6}-[A-Z]?\d{1,3})[\s:：]+(.+)$/u;

/** `1. 一级：…` / `2、二级：…` — numbered with an explicit tier word. */
const TIERED_NUMBERED_RE = /^\d{1,3}[.、)]\s*(一级|二级|三级)[：:]\s*(.+)$/u;

/** `1. …` under a section heading, no tier word. */
const NUMBERED_RE = /^\d{1,3}[.、)]\s*(.+)$/u;

/** Bullet carrying a hard prohibition or threshold. */
const REDLINE_PROSE_RE =
  /(不得|禁止|不低于|不高于|不得超过|不少于|不超过|须|应当|应附|应写明|视为不合格)/u;

/**
 * Explicit judgement tokens: the playbook itself says "this is a red line".
 * Recognised generically because a line ending in FAIL / 不接受 / 不合格 is a
 * constraint regardless of how the sentence is phrased — several real firm
 * playbooks use shorthand like `对方责任帽 50% → 红线 FAIL`.
 */
const VERDICT_TOKEN_RE = /(FAIL|红线|不合格|不接受|不予接受|不可接受|不予认可)/iu;

const TIER_MAP: Record<string, PlaybookTier> = {
  一级: "must_not",
  二级: "should_trade",
  三级: "advisory",
};

/**
 * Numbers a lawyer wrote down, kept verbatim. Deliberately broad: percents,
 * money, month/day counts, Chinese numerals with a unit. The point is to make
 * "this line states a threshold" observable, not to compute with it.
 */
const NUMBER_RE =
  /(\d+(?:\.\d+)?\s*(?:%|％|万元|万|元|个月|月|日|天|年|次|个工作日)|\d{1,3}\s*个工作日)/gu;

function numbersIn(text: string): string[] {
  const found = text.match(NUMBER_RE) ?? [];
  return [...new Set(found.map((s) => s.replace(/\s+/gu, "")))];
}

function headingOf(line: string): string | undefined {
  const m = /^#{1,4}\s+(.+)$/u.exec(line.trim());
  return m?.[1]?.trim();
}

/**
 * Extract structure from one playbook file.
 *
 * Heading lines and blank lines are not red lines; they set context or nothing.
 */
export function extractPlaybookStructure(text: string, source = "(playbook)"): PlaybookExtract {
  const lines: PlaybookLine[] = [];
  let section: string | undefined;
  let skipped = 0;

  const rawLines = text.split(/\r?\n/u);
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = (rawLines[i] ?? "").trim();
    if (!raw) {
      continue;
    }
    const heading = headingOf(raw);
    if (heading) {
      section = heading;
      continue;
    }
    // Meta lines (版本/适用范围/使用说明) are not red lines.
    if (/^(版本|适用范围|使用说明|说明)[：:]/u.test(raw)) {
      skipped += 1;
      continue;
    }

    const numbers = numbersIn(raw);

    const idHit = ID_PREFIX_RE.exec(raw);
    if (idHit?.[1] && idHit[2]) {
      lines.push({
        line: i + 1,
        raw,
        id: idHit[1],
        ...(section ? { section } : {}),
        tier: "must_not",
        numbers,
        status: "structured",
      });
      continue;
    }

    const tiered = TIERED_NUMBERED_RE.exec(raw);
    if (tiered?.[1] && tiered[2]) {
      lines.push({
        line: i + 1,
        raw,
        ...(section ? { section } : {}),
        tier: TIER_MAP[tiered[1]] ?? "should_trade",
        numbers,
        status: "structured",
      });
      continue;
    }

    const numbered = NUMBERED_RE.exec(raw);
    if (numbered?.[1]) {
      const body = numbered[1];
      // A numbered line without a tier word is only structured when it carries
      // a threshold; otherwise it is guidance prose.
      const structured =
        (REDLINE_PROSE_RE.test(body) || VERDICT_TOKEN_RE.test(body)) && numbers.length > 0;
      lines.push({
        line: i + 1,
        raw,
        ...(section ? { section } : {}),
        numbers,
        status: structured ? "structured" : "prose",
      });
      continue;
    }

    if (REDLINE_PROSE_RE.test(raw) || VERDICT_TOKEN_RE.test(raw)) {
      lines.push({
        line: i + 1,
        raw,
        ...(section ? { section } : {}),
        numbers,
        status: "prose",
      });
      continue;
    }

    skipped += 1;
  }

  return {
    source,
    lines,
    structured: lines.filter((l) => l.status === "structured").length,
    prose: lines.filter((l) => l.status === "prose").length,
    skipped,
  };
}

export type PlaybookCoverage = {
  files: number;
  lines: number;
  structured: number;
  prose: number;
  /** structured / (structured + prose). The mechanical floor. */
  structuredRatio: number;
  byFile: Array<{ source: string; structured: number; prose: number }>;
};

export function summarizePlaybookCoverage(extracts: readonly PlaybookExtract[]): PlaybookCoverage {
  const structured = extracts.reduce((n, e) => n + e.structured, 0);
  const prose = extracts.reduce((n, e) => n + e.prose, 0);
  const total = structured + prose;
  return {
    files: extracts.length,
    lines: total,
    structured,
    prose,
    structuredRatio: total === 0 ? 0 : structured / total,
    byFile: extracts.map((e) => ({
      source: e.source,
      structured: e.structured,
      prose: e.prose,
    })),
  };
}
