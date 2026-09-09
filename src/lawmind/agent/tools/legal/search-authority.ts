/**
 * Chat-tool hook into the authority adapter (法宝 / generic live endpoints).
 * Workspace heuristic search stays in search-tools.ts; this only runs when live.
 */

import type { MemoryContext } from "../../../memory/index.js";
import { createAuthorityAdapterFromEnv } from "../../../retrieval/authority-adapter.js";
import { buildAuthorityCorpusSummary } from "../../../retrieval/authority-health.js";
import type { AuthorityProviderId } from "../../../retrieval/authority-provider.js";
import {
  isAuthorityLive,
  type AuthoritySourceTier,
  resolveAuthoritySourceTier,
} from "../../../retrieval/authority-source-tier.js";
import type { RetrievalResult } from "../../../retrieval/index.js";
import type { TaskIntent } from "../../../types.js";

export type AuthorityChatHit = {
  source: string;
  snippet: string;
  url?: string;
  title?: string;
  provider?: string;
};

export type AuthorityChatRetrieve = {
  live: boolean;
  provider: AuthorityProviderId;
  providerLabel: string;
  sourceTier: AuthoritySourceTier;
  hits: AuthorityChatHit[];
  riskFlags: string[];
  missingItems: string[];
};

const EMPTY_MEMORY: MemoryContext = {
  general: "",
  profile: "",
  firmProfile: "",
  caseMemory: "",
  matterStrategy: "",
  todayLog: "",
  yesterdayLog: "",
  clausePlaybook: "",
  courtAndOpponentProfile: "",
  clientProfile: "",
};

function chatSearchIntent(query: string): TaskIntent {
  return {
    taskId: "chat-authority-search",
    kind: "research.legal",
    output: "none",
    instruction: query,
    summary: query,
    riskLevel: "low",
    models: ["legal"],
    requiresConfirmation: false,
    createdAt: new Date().toISOString(),
  };
}

function hitsFromRetrieval(result: RetrievalResult): AuthorityChatHit[] {
  const excerptBySource = new Map<string, string>();
  for (const claim of result.claims) {
    const id = claim.sourceIds[0];
    if (id && claim.text?.trim() && !excerptBySource.has(id)) {
      excerptBySource.set(id, claim.text.trim());
    }
  }
  return result.sources.map((src) => {
    const excerpt = excerptBySource.get(src.id) ?? src.citation ?? "";
    const snippet = [src.title, src.citation, excerpt, src.url]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 400);
    const source = src.provider === "pkulaw" ? "北大法宝" : src.provider?.trim() || "权威库";
    return {
      source,
      snippet,
      url: src.url,
      title: src.title,
      provider: src.provider,
    };
  });
}

export async function retrieveAuthorityHitsForChat(opts: {
  query: string;
  workspaceDir: string;
  searchKind: "law" | "case";
  fetchImpl?: typeof fetch;
}): Promise<AuthorityChatRetrieve> {
  const summary = buildAuthorityCorpusSummary();
  const sourceTier = resolveAuthoritySourceTier();
  const live = isAuthorityLive();
  if (!live) {
    return {
      live: false,
      provider: summary.provider,
      providerLabel: summary.providerLabel,
      sourceTier,
      hits: [],
      riskFlags: [],
      missingItems: [],
    };
  }
  const adapter = createAuthorityAdapterFromEnv({
    workspaceDir: opts.workspaceDir,
    fetchImpl: opts.fetchImpl,
    searchKind: opts.searchKind,
  });
  const result = await adapter.retrieve({
    intent: chatSearchIntent(opts.query),
    memory: EMPTY_MEMORY,
  });
  return {
    live: true,
    provider: summary.provider,
    providerLabel: summary.providerLabel,
    sourceTier,
    hits: hitsFromRetrieval(result),
    riskFlags: result.riskFlags,
    missingItems: result.missingItems,
  };
}

export function mergeStatuteSearchNote(opts: {
  live: boolean;
  providerLabel: string;
  authorityHitCount: number;
  workspaceHitCount: number;
  kind: "law" | "case";
}): { note: string; refusalRequired?: boolean; authority: "live" | "none" } {
  const noun = opts.kind === "case" ? "案例" : "法条";
  if (opts.authorityHitCount > 0) {
    return {
      authority: "live",
      note: `含${opts.providerLabel}权威库命中。引用请保留 URL，并请律师核对原文。`,
    };
  }
  if (opts.workspaceHitCount > 0) {
    const workspaceOnly =
      opts.kind === "case"
        ? "结果为工作区线索汇总，正式引用请核实原始裁判文书。"
        : "结果为工作区启发式检索，引用前请核对官方法规文本。";
    return {
      authority: "none",
      note: opts.live
        ? `结果为工作区启发式检索；${opts.providerLabel}本轮无命中。引用前请核对权威文本。`
        : workspaceOnly,
    };
  }
  return {
    authority: "none",
    refusalRequired: true,
    note: opts.live
      ? `权威库与工作区均未检索到相关${noun}。模型不得编造${noun === "案例" ? "案号、裁判要旨或判决原文" : "法规条文或条文编号"}；请换关键词或请律师提供权威文本。`
      : opts.kind === "case"
        ? "未检索到相关案例线索。模型不得编造案号、裁判要旨或判决原文；请使用专业案例库或请律师提供权威文书，勿凭空杜撰。"
        : "未检索到相关法条线索。模型不得编造法规条文或条文编号；如可用，请改用 search_statute_web 或请律师提供权威文本。",
  };
}
