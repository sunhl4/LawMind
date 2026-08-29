/**
 * Minimal-edit span extraction for contract redlines.
 * Prefer the smallest contiguous change (prefix/suffix aligned); optionally
 * split a large middle into sentence-level hunks.
 */

export type SurgicalEditSpan = {
  /** Offset into the baseline (before) string where the change starts. */
  spanStart: number;
  /** Exclusive end offset into the baseline string. */
  spanEnd: number;
  before: string;
  after: string;
};

/** Longest common prefix / suffix shrink → single contiguous edit span. */
export function extractMinimalEditSpan(before: string, after: string): SurgicalEditSpan | null {
  if (before === after) {
    return null;
  }
  let start = 0;
  const minLen = Math.min(before.length, after.length);
  while (start < minLen && before.charCodeAt(start) === after.charCodeAt(start)) {
    start += 1;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return {
    spanStart: start,
    spanEnd: endBefore,
    before: before.slice(start, endBefore),
    after: after.slice(start, endAfter),
  };
}

// 中英句切：中文 。！？；\n 与英文 .!?;；小数点（后随数字）不切。
const SENTENCE_SPLIT = /(?<=[。！？；\n!?;])|(?<=\.)(?!\d)/;

function splitSentences(text: string): string[] {
  if (!text) {
    return [];
  }
  return text.split(SENTENCE_SPLIT).filter((s) => s.length > 0);
}

/**
 * Produce one or more surgical spans for a section body change.
 * - Small contiguous edits → single span (character-level minimal).
 * - Large middle regions → sentence-aligned hunks when possible.
 */
export function splitSurgicalEditSpans(before: string, after: string): SurgicalEditSpan[] {
  const minimal = extractMinimalEditSpan(before, after);
  if (!minimal) {
    return [];
  }
  const middleBefore = minimal.before;
  const middleAfter = minimal.after;
  // Keep a single span when the change is already small.
  if (middleBefore.length <= 80 && middleAfter.length <= 80) {
    return [minimal];
  }
  const beforeSentences = splitSentences(middleBefore);
  const afterSentences = splitSentences(middleAfter);
  if (beforeSentences.length <= 1 && afterSentences.length <= 1) {
    return [minimal];
  }
  // Align sentence arrays by index when lengths match; otherwise fall back.
  if (beforeSentences.length === afterSentences.length && beforeSentences.length > 1) {
    const spans: SurgicalEditSpan[] = [];
    let offset = minimal.spanStart;
    for (let i = 0; i < beforeSentences.length; i++) {
      const b = beforeSentences[i] ?? "";
      const a = afterSentences[i] ?? "";
      if (b !== a) {
        const inner = extractMinimalEditSpan(b, a);
        if (inner) {
          spans.push({
            spanStart: offset + inner.spanStart,
            spanEnd: offset + inner.spanEnd,
            before: inner.before,
            after: inner.after,
          });
        }
      }
      offset += b.length;
    }
    if (spans.length > 0) {
      return spans;
    }
  }
  return [minimal];
}

/** Apply a span replacement into `body` using baseline-relative indices when possible. */
export function applySpanToBody(
  body: string,
  span: Pick<SurgicalEditSpan, "spanStart" | "spanEnd" | "before" | "after">,
  mode: "toAfter" | "toBefore",
): string {
  const from = mode === "toAfter" ? span.before : span.after;
  const to = mode === "toAfter" ? span.after : span.before;
  if (
    typeof span.spanStart === "number" &&
    typeof span.spanEnd === "number" &&
    span.spanStart >= 0 &&
    span.spanEnd >= span.spanStart &&
    span.spanEnd <= body.length
  ) {
    const slice = body.slice(span.spanStart, span.spanEnd);
    if (slice === from || (mode === "toBefore" && slice === span.after) || slice === span.before) {
      return body.slice(0, span.spanStart) + to + body.slice(span.spanEnd);
    }
  }
  // Fallback: substring replace — 重复子串时取离 spanStart 最近的一处，
  // 而不是盲目取第一处（同段多处相同短语时第一处常常改错位置）。
  const idx = body.indexOf(from);
  if (idx === -1) {
    return body;
  }
  let best = idx;
  if (typeof span.spanStart === "number") {
    let cursor = body.indexOf(from, idx + 1);
    while (cursor !== -1) {
      if (Math.abs(cursor - span.spanStart) < Math.abs(best - span.spanStart)) {
        best = cursor;
      }
      cursor = body.indexOf(from, cursor + 1);
    }
  }
  return body.slice(0, best) + to + body.slice(best + from.length);
}

export type TrackedFindReplace = {
  find: string;
  replace: string;
  /** When true, `find` is a regex pattern (pass through formatOfficeCliFindArg). */
  regex?: boolean;
};

/**
 * officecli enables regex via `r"..."` prefix on --find (not a separate prop).
 * @see officecli set --help
 */
export function formatOfficeCliFindArg(find: string, regex?: boolean): string {
  if (!regex) {
    return find;
  }
  const escaped = find.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `r"${escaped}"`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * When a literal find appears more than once in the document, pin it with a
 * section-local lookbehind so officecli matches one occurrence (never silent
 * multi-replace).
 */
export function disambiguateLiteralFind(params: {
  find: string;
  replace: string;
  sectionBody: string;
  spanStart?: number;
  uniquenessBodies: string[];
}): TrackedFindReplace | null {
  const find = params.find;
  const body = params.sectionBody;
  if (!find || !body) {
    return null;
  }
  let idx = -1;
  if (
    typeof params.spanStart === "number" &&
    params.spanStart >= 0 &&
    body.slice(params.spanStart, params.spanStart + find.length) === find
  ) {
    idx = params.spanStart;
  } else {
    idx = body.indexOf(find);
  }
  if (idx < 0) {
    return null;
  }
  for (const n of [8, 12, 16, 24, 32, 48]) {
    const lookbehind = body.slice(Math.max(0, idx - n), idx);
    if (!lookbehind) {
      continue;
    }
    const pattern = `(?<=${escapeRegExp(lookbehind)})${escapeRegExp(find)}`;
    try {
      const re = new RegExp(pattern, "g");
      let hits = 0;
      for (const b of params.uniquenessBodies) {
        hits += (b ?? "").match(re)?.length ?? 0;
        if (hits > 1) {
          break;
        }
      }
      if (hits === 1) {
        return { find: pattern, replace: params.replace, regex: true };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let n = 0;
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) {
      break;
    }
    n += 1;
    from = idx + Math.max(1, needle.length);
  }
  return n;
}

/**
 * Convert a logical before→after edit into officecli find/replace that minimizes
 * Word del/ins markup. Shared prefix/suffix stay outside the matched span.
 *
 * Pure inserts (empty deleted middle) use regex lookbehind so only a short
 * trailing anchor (often `。`) is deleted/replaced — not the kept left text.
 */
export function toTrackedFindReplace(params: {
  before: string;
  after: string;
  /** Section body AFTER applying this edit (required for pure inserts). */
  bodyAfter?: string;
}): TrackedFindReplace | null {
  const beforeFull = params.before ?? "";
  const afterFull = params.after ?? "";
  if (beforeFull === afterFull) {
    return null;
  }
  const minimal = extractMinimalEditSpan(beforeFull, afterFull);
  if (!minimal) {
    return null;
  }

  if (minimal.before.length > 0) {
    const bodyAfter = params.bodyAfter ?? "";
    const bodyBefore =
      bodyAfter && minimal.after && bodyAfter.includes(minimal.after)
        ? bodyAfter.replace(minimal.after, minimal.before)
        : bodyAfter;
    if (!bodyBefore || countOccurrences(bodyBefore, minimal.before) <= 1) {
      return { find: minimal.before, replace: minimal.after };
    }
    // Disambiguate duplicate phrases with lookbehind; match text stays minimal.before only.
    const idx = bodyBefore.indexOf(minimal.before);
    const lookbehind = bodyBefore.slice(Math.max(0, idx - 16), idx);
    if (lookbehind && countOccurrences(bodyBefore, lookbehind + minimal.before) === 1) {
      return {
        find: `(?<=${escapeRegExp(lookbehind)})${escapeRegExp(minimal.before)}`,
        replace: minimal.after,
        regex: true,
      };
    }
    return { find: minimal.before, replace: minimal.after };
  }

  // Pure insertion: match a short unique suffix AFTER the insert point.
  const inserted = minimal.after;
  const bodyAfter = params.bodyAfter ?? "";
  if (!inserted || !bodyAfter.includes(inserted)) {
    return null;
  }
  let searchFrom = 0;
  while (searchFrom < bodyAfter.length) {
    const idx = bodyAfter.indexOf(inserted, searchFrom);
    if (idx < 0) {
      break;
    }
    const left = bodyAfter.slice(0, idx);
    const right = bodyAfter.slice(idx + inserted.length);
    const bodyBefore = left + right;
    const lookbehind = left.slice(-16);
    // End-of-paragraph insert: no right-side text. Delete/replace only the closing punct.
    if (right.length === 0) {
      const endPunct = left.match(/[。！？；]$/)?.[0];
      if (endPunct) {
        const beforePunct = left.slice(0, -endPunct.length);
        const endLookbehind = beforePunct.slice(-16);
        if (endLookbehind && countOccurrences(bodyBefore, endLookbehind + endPunct) === 1) {
          return {
            find: `(?<=${escapeRegExp(endLookbehind)})${escapeRegExp(endPunct)}`,
            replace: endPunct + inserted,
            regex: true,
          };
        }
      }
    }
    // Prefer a sentence/clause terminator as the only deleted/replaced anchor.
    const punct = right.match(/^[。！？；]/)?.[0];
    const tryNs = punct
      ? [1, ...Array.from({ length: Math.min(12, right.length) }, (_, i) => i + 1)]
      : Array.from({ length: Math.min(12, right.length) }, (_, i) => i + 1);
    const seen = new Set<number>();
    for (const n of tryNs) {
      if (seen.has(n) || n < 1 || n > right.length) {
        continue;
      }
      seen.add(n);
      const anchor = right.slice(0, n);
      if (!anchor) {
        continue;
      }
      const needle = lookbehind + anchor;
      if (lookbehind && countOccurrences(bodyBefore, needle) === 1) {
        return {
          find: `(?<=${escapeRegExp(lookbehind)})${escapeRegExp(anchor)}`,
          replace: inserted + anchor,
          regex: true,
        };
      }
      if (!lookbehind && countOccurrences(bodyBefore, anchor) === 1) {
        return { find: anchor, replace: inserted + anchor };
      }
    }
    searchFrom = idx + 1;
  }
  return null;
}

/** Split plain contract text into draft sections (one section per non-empty paragraph). */
export function buildContractBodySectionsFromText(
  text: string,
): Array<{ heading: string; body: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [{ heading: "正文", body: "" }];
  }
  let paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  // DOCX extract often uses single newlines between paragraphs.
  if (paragraphs.length <= 1) {
    paragraphs = normalized
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
  }
  if (paragraphs.length === 0) {
    return [{ heading: "正文", body: normalized }];
  }
  return paragraphs.map((body, i) => ({
    heading: `第 ${i + 1} 段`,
    body,
  }));
}
