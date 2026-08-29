/**
 * Drop retrieval hits that clearly do not match the research topic.
 */

import type { ResearchBundle, ResearchClaim, ResearchSource, TaskIntent } from "../types.js";

const STOPWORDS = new Set([
  "的",
  "了",
  "和",
  "与",
  "及",
  "或",
  "在",
  "是",
  "为",
  "对",
  "等",
  "及",
  "请",
  "做",
  "一份",
  "关于",
  "以及",
  "进行",
  "相关",
  "研究",
  "报告",
  "卷宗",
  "交办",
  "类型",
  "代码",
  "交付物",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "report",
  "compliance",
]);

/** Extract coarse topic tokens from instruction (CJK bigrams + latin words). */
export function extractTopicTokens(text: string): string[] {
  const raw = text.toLowerCase();
  const tokens = new Set<string>();
  for (const m of raw.match(/[a-z]{3,}|[一-龥]{2,}/g) ?? []) {
    if (STOPWORDS.has(m)) {
      continue;
    }
    if (m.length >= 2) {
      tokens.add(m);
    }
  }
  // Prefer longer CJK chunks: also add overlapping bigrams from longer runs
  for (const run of raw.match(/[一-龥]{4,}/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bi = run.slice(i, i + 2);
      if (!STOPWORDS.has(bi)) {
        tokens.add(bi);
      }
    }
  }
  return [...tokens].slice(0, 48);
}

function haystackForClaim(claim: ResearchClaim, sources: ResearchSource[]): string {
  const srcBits = claim.sourceIds
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => `${s!.title} ${s!.citation ?? ""} ${s!.url ?? ""}`);
  return `${claim.text} ${srcBits.join(" ")}`.toLowerCase();
}

export function claimMatchesTopic(
  claim: ResearchClaim,
  sources: ResearchSource[],
  tokens: string[],
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const hay = haystackForClaim(claim, sources);
  let hits = 0;
  for (const t of tokens) {
    if (hay.includes(t)) {
      hits += 1;
    }
  }
  // Need at least one strong token hit; for sparse tokens require 1, else ~15% of tokens
  const need = tokens.length <= 4 ? 1 : Math.max(1, Math.floor(tokens.length * 0.12));
  return hits >= need;
}

export function filterBundleByTopicRelevance(
  intent: TaskIntent,
  bundle: ResearchBundle,
): { bundle: ResearchBundle; droppedClaims: number; topicTokens: string[] } {
  const tokens = extractTopicTokens(`${intent.instruction}\n${intent.summary ?? ""}`);
  if (tokens.length === 0 || bundle.claims.length === 0) {
    return { bundle, droppedClaims: 0, topicTokens: tokens };
  }

  const keptClaims = bundle.claims.filter((c) => claimMatchesTopic(c, bundle.sources, tokens));
  const droppedClaims = bundle.claims.length - keptClaims.length;
  if (droppedClaims === 0) {
    return { bundle, droppedClaims: 0, topicTokens: tokens };
  }

  const keptSourceIds = new Set(keptClaims.flatMap((c) => c.sourceIds));
  // Keep sources still referenced; drop orphan demo hits that only backed discarded claims
  const keptSources =
    keptSourceIds.size > 0 ? bundle.sources.filter((s) => keptSourceIds.has(s.id)) : [];

  const riskFlags = [...bundle.riskFlags];
  if (keptClaims.length === 0) {
    riskFlags.push(
      "检索结果与主题无关/证据不足：已丢弃不相关结论，请开启联网或补充权威 URL 后重跑",
    );
  } else if (droppedClaims > 0) {
    riskFlags.push(`已过滤 ${droppedClaims} 条与主题无关的检索结论`);
  }

  return {
    topicTokens: tokens,
    droppedClaims,
    bundle: {
      ...bundle,
      claims: keptClaims,
      sources: keptSources.length > 0 ? keptSources : bundle.sources,
      riskFlags: [...new Set(riskFlags)],
      missingItems: [
        ...new Set([
          ...bundle.missingItems,
          ...(keptClaims.length === 0 ? ["与主题相关的权威来源"] : []),
        ]),
      ],
    },
  };
}
