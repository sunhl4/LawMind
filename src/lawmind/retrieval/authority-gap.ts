/**
 * Lawyer-facing copy when statute/case retrieval has no authority hits,
 * plus result-level demo-corpus watermark detection for acceptance/chat.
 *
 * Browser-safe: do not import Node builtins (renderer pulls this via chat SSE glue).
 */

/** Lawyer-facing watermark when hits come from open sample / demo CORPUS. */
export const DEMO_CORPUS_RISK_FLAG =
  "演示语料（非正式完整法库；正式引用请核对官方法条）";

export type AuthorityGapSignal = {
  refusalRequired?: boolean;
  authority?: string;
  note?: string;
  missingItems?: string[];
  riskFlags?: string[];
  sources?: Array<{ demo?: boolean }>;
  claims?: Array<{ demo?: boolean }>;
};

/** True when tool/research result says "do not invent statutes/cases". */
export function isAuthorityGap(signal: AuthorityGapSignal | null | undefined): boolean {
  if (!signal) {
    return false;
  }
  if (signal.refusalRequired === true) {
    return true;
  }
  if (signal.authority === "none") {
    return true;
  }
  if (
    Array.isArray(signal.missingItems) &&
    signal.missingItems.some((m) => /不得编造|未配置|无命中|未检索|缺源/.test(m))
  ) {
    return true;
  }
  return false;
}

export function formatAuthorityGapLawyerNotice(opts?: {
  toolName?: string;
  note?: string;
}): string {
  const name = opts?.toolName?.trim() ?? "";
  const isCase = name === "search_case_law";
  const isStatute = name === "search_statute" || name === "search_statute_web";
  const tool = isCase ? "类案检索" : isStatute ? "法条检索" : "权威检索";
  const detail = opts?.note?.trim();
  const defaultDetail = isCase
    ? "请勿编造案号或裁判要旨。请换关键词、配置权威库，或手工提供裁判文书后再引用。"
    : isStatute
      ? "请勿编造条文编号。请换关键词、配置权威库，或手工提供官方法条后再引用。"
      : "请勿将模型口述当作已核实法条/案号。请换关键词、配置权威库，或手工提供官方法条/裁判文书后再引用。";
  return [`缺源 · ${tool}未命中权威结果`, detail || defaultDetail].join("：");
}

/** Inspect a generic tool result payload (ok + data). */
export function authorityGapFromToolResult(result: {
  ok?: boolean;
  data?: unknown;
}): boolean {
  if (!result?.ok || result.data == null || typeof result.data !== "object") {
    return false;
  }
  return isAuthorityGap(result.data as AuthorityGapSignal);
}

/** True when retrieval hits are from open sample / demo-marked CORPUS. */
export function isDemoCorpusResult(data: unknown): boolean {
  if (data == null || typeof data !== "object") {
    return false;
  }
  const o = data as AuthorityGapSignal & {
    demoCorpus?: boolean;
    topSources?: Array<{ demo?: boolean }>;
  };
  if (o.demoCorpus === true) {
    return true;
  }
  if (
    Array.isArray(o.riskFlags) &&
    o.riskFlags.some((f) => typeof f === "string" && f.includes("演示语料"))
  ) {
    return true;
  }
  if (Array.isArray(o.sources) && o.sources.some((s) => s?.demo === true)) {
    return true;
  }
  if (Array.isArray(o.topSources) && o.topSources.some((s) => s?.demo === true)) {
    return true;
  }
  if (Array.isArray(o.claims) && o.claims.some((c) => c?.demo === true)) {
    return true;
  }
  return false;
}

export function demoCorpusFromToolResult(result: {
  ok?: boolean;
  data?: unknown;
}): boolean {
  if (!result?.ok || result.data == null) {
    return false;
  }
  return isDemoCorpusResult(result.data);
}

export function formatDemoCorpusLawyerNotice(): string {
  return DEMO_CORPUS_RISK_FLAG;
}
