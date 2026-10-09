/**
 * After enough statute/case searches, the next sample writes the named file.
 * Once that happens, search tools stay off for the rest of the turn.
 * The model still chooses the words.
 */

export const SEARCH_SYNTHESIS_TOOL_NAMES = [
  "search_statute",
  "search_case_law",
  "search_statute_web",
  "web_search",
] as const;

export const WRITE_SYNTHESIS_TOOL_NAMES = ["write_document", "draft_document"] as const;

/** Searches already run this turn before the write sample. */
export const WRITE_SYNTHESIS_SEARCH_CAP = 4;

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

export function shouldSynthesizeBeforeWrite(opts: {
  missingDeliverables: readonly string[];
  searchCalls: number;
  advertisedToolNames: readonly string[];
}): boolean {
  if (opts.missingDeliverables.length === 0) {
    return false;
  }
  if (opts.searchCalls < WRITE_SYNTHESIS_SEARCH_CAP) {
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
    "检索先停。本回合不要再调用 search_statute、search_case_law、search_statute_web 或 web_search。",
    "检索结果里已经出现的条号和条文原文写进稿里。没检索到的条号标【待核实】。",
    "法律理由、诉讼请求和题目要求的结论仍写完整，不要整段留空。",
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
