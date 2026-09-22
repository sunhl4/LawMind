/**
 * Shared authority hit → ResearchSource/Claim mapping (claims require sourceIds).
 */

import { randomUUID } from "node:crypto";
import type { ResearchClaim, ResearchSource } from "../types.js";
import { DEMO_CORPUS_RISK_FLAG } from "./authority-gap.js";
import type { RetrievalResult } from "./index.js";

export { DEMO_CORPUS_RISK_FLAG };

export type AuthorityHit = {
  id?: string;
  title: string;
  kind?: "statute" | "case" | "regulation" | "other";
  citation?: string;
  excerpt?: string;
  url?: string;
  /** Result-level demo mark (bundled sample or CORPUS tagged demo). */
  demo?: boolean;
  /** Open-law / vendor provider id (e.g. open-law.npc_flk) — never 法宝 unless true). */
  provider?: string;
  /** Corpus / dump id for attribution. */
  corpusId?: string;
  /** Short license / attribution note. */
  licenseNote?: string;
};

export function mapAuthorityKind(k: AuthorityHit["kind"]): ResearchSource["kind"] {
  if (k === "statute") {
    return "statute";
  }
  if (k === "regulation") {
    return "regulation";
  }
  if (k === "case") {
    return "case";
  }
  return "unknown";
}

export function mapHitsToRetrievalResult(rawHits: AuthorityHit[]): RetrievalResult {
  if (rawHits.length === 0) {
    return {
      sources: [],
      claims: [],
      riskFlags: ["权威库无命中"],
      missingItems: [
        "权威库未检索到相关法条/案例。模型不得编造条文；请换关键词或请律师提供权威文本。",
      ],
    };
  }
  const sources: ResearchSource[] = [];
  const claims: ResearchClaim[] = [];
  let anyDemo = false;
  for (const hit of rawHits.slice(0, 20)) {
    if (!hit?.title?.trim()) {
      continue;
    }
    const id = hit.id?.trim() || randomUUID();
    const demo = hit.demo === true;
    if (demo) {
      anyDemo = true;
    }
    sources.push({
      id,
      title: hit.title.trim(),
      kind: mapAuthorityKind(hit.kind),
      url: hit.url,
      citation: hit.citation,
      ...(demo ? { demo: true } : {}),
      ...(hit.provider ? { provider: hit.provider } : {}),
      ...(hit.corpusId ? { corpusId: hit.corpusId } : {}),
      ...(hit.licenseNote ? { licenseNote: hit.licenseNote } : {}),
    });
    if (hit.excerpt?.trim()) {
      claims.push({
        text: hit.excerpt.trim().slice(0, 500),
        sourceIds: [id],
        confidence: demo ? 0.55 : 0.7,
        model: "legal",
        ...(demo ? { demo: true } : {}),
      });
    }
  }
  if (sources.length === 0) {
    return {
      sources: [],
      claims: [],
      riskFlags: ["权威库无命中"],
      missingItems: [
        "权威库未检索到相关法条/案例。模型不得编造条文；请换关键词或请律师提供权威文本。",
      ],
    };
  }
  return {
    sources,
    claims,
    riskFlags: anyDemo ? [DEMO_CORPUS_RISK_FLAG] : [],
    missingItems: [],
  };
}

/** Lawyer-facing fail-closed for HTTP / quota errors (no fabrication). */
export function authorityHttpErrorResult(status: number): RetrievalResult {
  if (status === 401 || status === 403) {
    return {
      sources: [],
      claims: [],
      riskFlags: [`权威检索鉴权失败（HTTP ${status}）`],
      missingItems: [
        "权威库鉴权失败：请检查 LAWMIND_AUTHORITY_API_KEY / 厂商 Token；在确认前不得编造法条。",
      ],
    };
  }
  if (status === 402 || status === 429) {
    return {
      sources: [],
      claims: [],
      riskFlags: [`权威检索配额不足或限流（HTTP ${status}）`],
      missingItems: [
        "权威库调用额度不足或被限流：请稍后重试或联系管理员扩容；不得编造法条替代检索。",
      ],
    };
  }
  return {
    sources: [],
    claims: [],
    riskFlags: [`权威检索 HTTP ${status}`],
    missingItems: ["权威检索失败，请稍后重试或手动补充法条来源。"],
  };
}

export function unsetAuthorityResult(): RetrievalResult {
  return {
    sources: [],
    claims: [],
    riskFlags: ["权威法律库未配置（LAWMIND_AUTHORITY_ENDPOINT）"],
    missingItems: [
      "权威法规/案例库未配置：不得编造法条编号或裁判要旨；请律师补充权威文本或配置检索端点。",
    ],
  };
}

export function invalidAuthorityEndpointResult(detail: string): RetrievalResult {
  return {
    sources: [],
    claims: [],
    riskFlags: [`权威端点无效（fail-closed）：${detail}`],
    missingItems: [
      "权威检索端点配置无效，已拒绝外呼：不得编造法条；请修正 LAWMIND_AUTHORITY_ENDPOINT 或由律师补充权威文本。",
    ],
  };
}
