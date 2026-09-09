/**
 * Open-law authority retrieve (OSS default path).
 *
 * Modes (LAWMIND_OPEN_LAW_MODE):
 * - local (default): bundled sample + LAWMIND_OPEN_LAW_CORPUS
 * - npc_flk: live 国家法律法规数据库 list API (opt-in LAWMIND_OPEN_LAW_NPC=1)
 * - caseopen: self-hosted cncases /api/search (opt-in LAWMIND_OPEN_LAW_CASEOPEN=1)
 * - courtlistener: Free Law Project REST v4 (opt-in LAWMIND_OPEN_LAW_COURTLISTENER=1)
 * - eurlex: EU CELLAR SPARQL (opt-in LAWMIND_OPEN_LAW_EURLEX=1)
 * - egov_jp: Japan e-Gov 法令 API v2 (opt-in LAWMIND_OPEN_LAW_EGOV_JP=1)
 * - hybrid: local first; then each enabled live source in China → US/EU/JP order
 */

import { createOutboundProxy } from "../../../platform/outbound-proxy.js";
import { mapHitsToRetrievalResult, type AuthorityHit } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import type { RetrievalResult } from "../../index.js";
import { isCaseopenLiveEnabled, searchCaseopenLive } from "./caseopen.js";
import { isCourtListenerLiveEnabled, searchCourtListenerLive } from "./courtlistener.js";
import { isEgovJpLiveEnabled, searchEgovJpLive } from "./egov-jp.js";
import { isEurlexLiveEnabled, searchEurlexLive } from "./eurlex.js";
import { searchOpenLawCorpus } from "./local-corpus.js";
import { isNpcFlkLiveEnabled, searchNpcFlkLive } from "./npc-flk.js";
import type { OpenLawMode } from "./types.js";

export type OpenLawRetrieveSource =
  | "local"
  | "npc_flk"
  | "caseopen"
  | "courtlistener"
  | "eurlex"
  | "egov_jp"
  | "none";

type LiveSearchFn = (opts: {
  query: string;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
}) => Promise<{ hits: AuthorityHit[]; httpStatus?: number; error?: string }>;

type LiveLane = {
  source: Exclude<OpenLawRetrieveSource, "local" | "none">;
  enabled: () => boolean;
  missingFlag: string;
  emptyLabel: string;
  search: LiveSearchFn;
};

const LIVE_LANES: LiveLane[] = [
  {
    source: "npc_flk",
    enabled: isNpcFlkLiveEnabled,
    missingFlag: "LAWMIND_OPEN_LAW_NPC=1",
    emptyLabel: "NPC FLK",
    search: searchNpcFlkLive,
  },
  {
    source: "caseopen",
    enabled: isCaseopenLiveEnabled,
    missingFlag: "LAWMIND_OPEN_LAW_CASEOPEN=1",
    emptyLabel: "caseopen",
    search: searchCaseopenLive,
  },
  {
    source: "courtlistener",
    enabled: isCourtListenerLiveEnabled,
    missingFlag: "LAWMIND_OPEN_LAW_COURTLISTENER=1",
    emptyLabel: "CourtListener",
    search: searchCourtListenerLive,
  },
  {
    source: "eurlex",
    enabled: isEurlexLiveEnabled,
    missingFlag: "LAWMIND_OPEN_LAW_EURLEX=1",
    emptyLabel: "EUR-Lex",
    search: searchEurlexLive,
  },
  {
    source: "egov_jp",
    enabled: isEgovJpLiveEnabled,
    missingFlag: "LAWMIND_OPEN_LAW_EGOV_JP=1",
    emptyLabel: "e-Gov",
    search: searchEgovJpLive,
  },
];

export function resolveOpenLawMode(opts?: { mode?: string }): OpenLawMode {
  const raw = (opts?.mode ?? process.env.LAWMIND_OPEN_LAW_MODE ?? "local").trim().toLowerCase();
  if (raw === "npc_flk" || raw === "npc" || raw === "flk") {
    return "npc_flk";
  }
  if (raw === "caseopen" || raw === "cncases" || raw === "cases") {
    return "caseopen";
  }
  if (
    raw === "courtlistener" ||
    raw === "cl" ||
    raw === "flp" ||
    raw === "harvard_cap" ||
    raw === "cap"
  ) {
    return "courtlistener";
  }
  if (raw === "eurlex" || raw === "cellar" || raw === "eu") {
    return "eurlex";
  }
  if (raw === "egov_jp" || raw === "egov" || raw === "jp") {
    return "egov_jp";
  }
  if (raw === "hybrid") {
    return "hybrid";
  }
  return "local";
}

function laneBySource(source: LiveLane["source"]): LiveLane {
  const lane = LIVE_LANES.find((l) => l.source === source);
  if (!lane) {
    throw new Error(`unknown open-law lane: ${source}`);
  }
  return lane;
}

async function retrieveLiveLane(
  lane: LiveLane,
  opts: {
    query: string;
    fetchImpl?: typeof fetch;
    lookup?: AuthorityDnsLookupFn;
  },
): Promise<{ result: RetrievalResult; httpStatus?: number; source: OpenLawRetrieveSource }> {
  if (!lane.enabled()) {
    return {
      result: {
        sources: [],
        claims: [],
        riskFlags: [`开源权威：${lane.emptyLabel} 未启用`],
        missingItems: [
          `已选 ${lane.source}/hybrid 但未设置 ${lane.missingFlag}；请启用或改用 local 语料。不得编造法条。`,
        ],
      },
      source: "none",
    };
  }
  const live = await lane.search({
    query: opts.query,
    fetchImpl: opts.fetchImpl,
    lookup: opts.lookup,
  });
  if (live.hits.length > 0) {
    return {
      result: mapHitsToRetrievalResult(live.hits),
      httpStatus: live.httpStatus,
      source: lane.source,
    };
  }
  return {
    result: {
      ...mapHitsToRetrievalResult([]),
      riskFlags: [
        ...(mapHitsToRetrievalResult([]).riskFlags ?? []),
        live.error ? `${lane.emptyLabel}：${live.error}` : `${lane.emptyLabel} 无命中`,
      ],
    },
    httpStatus: live.httpStatus,
    source: "none",
  };
}

export async function openLawRetrieve(opts: {
  query: string;
  corpusPath?: string;
  mode?: OpenLawMode;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{
  result: RetrievalResult;
  httpStatus?: number;
  source: OpenLawRetrieveSource;
}> {
  // 统一出口代理：open-law live 适配器默认都经此代理，允许本地回环（caseopen 自建）。
  const openLawProxy = createOutboundProxy({
    fetchImpl: opts.fetchImpl,
    allowLocalNetwork: true,
    requestTag: "open-law",
  });
  const fetchImpl = openLawProxy.fetch.bind(openLawProxy);

  const mode = opts.mode ?? resolveOpenLawMode();
  const query = opts.query.trim();

  if (mode === "local" || mode === "hybrid") {
    const localHits = searchOpenLawCorpus(query, { corpusPath: opts.corpusPath });
    if (localHits.length > 0) {
      return { result: mapHitsToRetrievalResult(localHits), source: "local" };
    }
    if (mode === "local") {
      return { result: mapHitsToRetrievalResult([]), source: "none" };
    }
  }

  const laneOpts = { ...opts, fetchImpl };

  if (mode !== "hybrid") {
    return retrieveLiveLane(laneBySource(mode), laneOpts);
  }

  if (mode === "hybrid") {
    const tried: string[] = [];
    for (const lane of LIVE_LANES) {
      if (!lane.enabled()) {
        continue;
      }
      tried.push(lane.emptyLabel);
      const outcome = await retrieveLiveLane(lane, laneOpts);
      if (outcome.source === lane.source && outcome.result.sources.length > 0) {
        return outcome;
      }
    }
    return {
      result: {
        ...mapHitsToRetrievalResult([]),
        riskFlags: [
          ...(mapHitsToRetrievalResult([]).riskFlags ?? []),
          tried.length > 0
            ? `hybrid：本地无命中，且已试 ${tried.join("/")} 无命中`
            : "hybrid：本地无命中，且 NPC/caseopen/CourtListener/EUR-Lex/e-Gov 均未启用",
        ],
      },
      source: "none",
    };
  }

  return { result: mapHitsToRetrievalResult([]), source: "none" };
}
