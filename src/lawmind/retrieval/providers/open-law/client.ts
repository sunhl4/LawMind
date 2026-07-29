/**
 * Open-law authority retrieve (OSS default path).
 *
 * Modes (LAWMIND_OPEN_LAW_MODE):
 * - local (default): bundled sample + LAWMIND_OPEN_LAW_CORPUS
 * - npc_flk: live 国家法律法规数据库 list API (opt-in LAWMIND_OPEN_LAW_NPC=1)
 * - caseopen: self-hosted cncases /api/search (opt-in LAWMIND_OPEN_LAW_CASEOPEN=1)
 * - hybrid: local first; then NPC if enabled; then caseopen if enabled
 */

import type { RetrievalResult } from "../../index.js";
import { mapHitsToRetrievalResult } from "../../authority-hits.js";
import type { AuthorityDnsLookupFn } from "../../authority-url-guard.js";
import { isCaseopenLiveEnabled, searchCaseopenLive } from "./caseopen.js";
import { searchOpenLawCorpus } from "./local-corpus.js";
import { isNpcFlkLiveEnabled, searchNpcFlkLive } from "./npc-flk.js";
import type { OpenLawMode } from "./types.js";

export type OpenLawRetrieveSource = "local" | "npc_flk" | "caseopen" | "none";

export function resolveOpenLawMode(opts?: { mode?: string }): OpenLawMode {
  const raw = (opts?.mode ?? process.env.LAWMIND_OPEN_LAW_MODE ?? "local")
    .trim()
    .toLowerCase();
  if (raw === "npc_flk" || raw === "npc" || raw === "flk") {
    return "npc_flk";
  }
  if (raw === "caseopen" || raw === "cncases" || raw === "cases") {
    return "caseopen";
  }
  if (raw === "hybrid") {
    return "hybrid";
  }
  return "local";
}

async function retrieveNpcFlk(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ result: RetrievalResult; httpStatus?: number; source: OpenLawRetrieveSource }> {
  if (!isNpcFlkLiveEnabled()) {
    return {
      result: {
        sources: [],
        claims: [],
        riskFlags: ["开源权威：NPC FLK 未启用"],
        missingItems: [
          "已选 npc_flk/hybrid 但未设置 LAWMIND_OPEN_LAW_NPC=1；请启用或改用 local 语料。不得编造法条。",
        ],
      },
      source: "none",
    };
  }
  const live = await searchNpcFlkLive({
    query: opts.query,
    fetchImpl: opts.fetchImpl,
    lookup: opts.lookup,
  });
  if (live.hits.length > 0) {
    return {
      result: mapHitsToRetrievalResult(live.hits),
      httpStatus: live.httpStatus,
      source: "npc_flk",
    };
  }
  return {
    result: {
      ...mapHitsToRetrievalResult([]),
      riskFlags: [
        ...(mapHitsToRetrievalResult([]).riskFlags ?? []),
        live.error ? `NPC FLK：${live.error}` : "NPC FLK 无命中",
      ],
    },
    httpStatus: live.httpStatus,
    source: "none",
  };
}

async function retrieveCaseopen(opts: {
  query: string;
  fetchImpl?: typeof fetch;
  lookup?: AuthorityDnsLookupFn;
}): Promise<{ result: RetrievalResult; httpStatus?: number; source: OpenLawRetrieveSource }> {
  if (!isCaseopenLiveEnabled()) {
    return {
      result: {
        sources: [],
        claims: [],
        riskFlags: ["开源权威：caseopen 未启用"],
        missingItems: [
          "已选 caseopen/hybrid 但未设置 LAWMIND_OPEN_LAW_CASEOPEN=1；请自建 cncases 后启用，或改用 local 语料。不得编造裁判要旨。",
        ],
      },
      source: "none",
    };
  }
  const live = await searchCaseopenLive({
    query: opts.query,
    fetchImpl: opts.fetchImpl,
    lookup: opts.lookup,
  });
  if (live.hits.length > 0) {
    return {
      result: mapHitsToRetrievalResult(live.hits),
      httpStatus: live.httpStatus,
      source: "caseopen",
    };
  }
  return {
    result: {
      ...mapHitsToRetrievalResult([]),
      riskFlags: [
        ...(mapHitsToRetrievalResult([]).riskFlags ?? []),
        live.error ? `caseopen：${live.error}` : "caseopen 无命中",
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

  if (mode === "npc_flk") {
    return retrieveNpcFlk(opts);
  }

  if (mode === "caseopen") {
    return retrieveCaseopen(opts);
  }

  if (mode === "hybrid") {
    if (isNpcFlkLiveEnabled()) {
      const npc = await retrieveNpcFlk(opts);
      if (npc.source === "npc_flk" && npc.result.sources.length > 0) {
        return npc;
      }
    }
    if (isCaseopenLiveEnabled()) {
      const co = await retrieveCaseopen(opts);
      if (co.source === "caseopen" && co.result.sources.length > 0) {
        return co;
      }
    }
    return {
      result: {
        ...mapHitsToRetrievalResult([]),
        riskFlags: [
          ...(mapHitsToRetrievalResult([]).riskFlags ?? []),
          "hybrid：本地无命中，且 NPC/caseopen 未启用或无命中",
        ],
      },
      source: "none",
    };
  }

  return { result: mapHitsToRetrievalResult([]), source: "none" };
}
