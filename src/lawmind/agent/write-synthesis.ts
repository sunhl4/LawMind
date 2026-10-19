/**
 * After enough useful statute/case searches, nudge once to write the named file.
 * Demo-only or empty hits wait longer, so the write is not forced before a live article exists.
 * Search stays available on that nudge sample. If the named file is still missing
 * afterward, search tools leave the advertised table and a named call is rejected
 * until the file lands.
 * The model still chooses the words. A missing article is marked, not turned into a ban on the conclusion.
 */

export const SEARCH_SYNTHESIS_TOOL_NAMES = [
  "search_statute",
  "search_case_law",
  "search_statute_web",
  "web_search",
] as const;

export const WRITE_SYNTHESIS_TOOL_NAMES = ["write_document", "draft_document"] as const;

/** Searches already run this turn before the write sample, once a live hit exists. */
export const WRITE_SYNTHESIS_SEARCH_CAP = 4;

/** Extra searches allowed when every hit so far is demo corpus or empty. */
export const WRITE_SYNTHESIS_DEMO_ONLY_CAP = 8;

const LIVE_ARTICLE_RE = /第[0-9零〇一二三四五六七八九十百千]+条|案号|（\s*20\d{2}\s*）|\(20\d{2}\)/;

export const WRITE_SYNTHESIS_MARKER = "【写前合成】";

export const CALCULATE_PARAM_FAILURE_CAP = 2;

export const CALCULATE_PARAM_STOP_MARKER = "【计算停手】";

const SEARCH_SYNTHESIS_TOOL_SET = new Set<string>(SEARCH_SYNTHESIS_TOOL_NAMES);

const CALCULATE_PARAM_ERROR_RE = /必须/;

export function countSearchCalls(counts: Record<string, number> | undefined): number {
  if (!counts) {
    return 0;
  }
  let total = 0;
  for (const name of SEARCH_SYNTHESIS_TOOL_NAMES) {
    total += counts[name] ?? 0;
  }
  return total;
}

type SearchHistoryMessage = {
  toolCallResponses?: ReadonlyArray<{
    name?: string;
    result?: { ok?: boolean; data?: unknown };
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function hitLooksLive(hit: Record<string, unknown>): boolean {
  const text = ["title", "source", "snippet"]
    .map((key) => (typeof hit[key] === "string" ? hit[key] : ""))
    .join("\n");
  return LIVE_ARTICLE_RE.test(text);
}

/** A search counts as live only when it is not demo corpus and carries an article, case id, or source id. */
export function turnHasLiveStatuteHit(messages: readonly SearchHistoryMessage[]): boolean {
  for (const message of messages) {
    for (const response of message.toolCallResponses ?? []) {
      if (!response?.name || !SEARCH_SYNTHESIS_TOOL_SET.has(response.name)) {
        continue;
      }
      if (response.result?.ok === false) {
        continue;
      }
      const data = asRecord(response.result?.data);
      if (!data || data.demoCorpus === true) {
        continue;
      }
      const hits = Array.isArray(data.hits) ? data.hits : [];
      if (hits.some((hit) => hitLooksLive(asRecord(hit) ?? {}))) {
        return true;
      }
      const sourceIds = Array.isArray(data.sourceIds) ? data.sourceIds : [];
      if (sourceIds.some((id) => typeof id === "string" && id.trim().length > 0)) {
        return true;
      }
    }
  }
  return false;
}

export function shouldSynthesizeBeforeWrite(opts: {
  missingDeliverables: readonly string[];
  searchCalls: number;
  advertisedToolNames: readonly string[];
  /** False when this turn's searches are still demo-only or empty. Omitted keeps the live cap. */
  liveStatuteHit?: boolean;
}): boolean {
  if (opts.missingDeliverables.length === 0) {
    return false;
  }
  const cap =
    opts.liveStatuteHit === false ? WRITE_SYNTHESIS_DEMO_ONLY_CAP : WRITE_SYNTHESIS_SEARCH_CAP;
  if (opts.searchCalls < cap) {
    return false;
  }
  return opts.advertisedToolNames.some((name) =>
    (WRITE_SYNTHESIS_TOOL_NAMES as readonly string[]).includes(name),
  );
}

export function withholdSearchTools(names: readonly string[]): string[] {
  return names.filter((name) => !SEARCH_SYNTHESIS_TOOL_SET.has(name));
}

export function formatWriteSynthesisNudge(paths: readonly string[]): string {
  const list = paths.join("、");
  return [
    WRITE_SYNTHESIS_MARKER,
    "检索结果里已经出现的条号和条文原文写进稿里。没检索到的条号单独标【待核实】。",
    "演示语料不要写成权威来源或现行有效。",
    "法律理由、诉讼请求和题目要求的结论仍写完整，不要整段改成待核实。",
    `用 write_document 或 draft_document 写到 ${list}，然后结束。`,
  ].join("\n");
}

export function isCalculateParamFailure(error: string | undefined): boolean {
  return typeof error === "string" && error.length > 0 && CALCULATE_PARAM_ERROR_RE.test(error);
}

type CalculateHistoryMessage = {
  toolCallResponses?: ReadonlyArray<{
    name?: string;
    result?: { ok?: boolean; error?: string };
  }>;
};

/** Trailing calculate calls that failed because an input had the wrong shape. */
export function trailingCalculateParamFailures(
  messages: readonly CalculateHistoryMessage[],
): number {
  let failures = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const responses = messages[i]?.toolCallResponses;
    if (!responses?.length) {
      continue;
    }
    for (let j = responses.length - 1; j >= 0; j -= 1) {
      const response = responses[j];
      if (response?.name !== "calculate") {
        continue;
      }
      if (response.result?.ok) {
        return failures;
      }
      if (!isCalculateParamFailure(response.result?.error)) {
        return failures;
      }
      failures += 1;
    }
  }
  return failures;
}

export function formatCalculateParamStopNudge(): string {
  return `${CALCULATE_PARAM_STOP_MARKER} calculate 已因参数连续失败。不要再用同一组参数重试。未算出的数在稿里标明未核算。`;
}
