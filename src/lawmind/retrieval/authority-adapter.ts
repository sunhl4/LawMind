/**
 * Authority retrieval adapter (P2-1).
 *
 * When LAWMIND_AUTHORITY_ENDPOINT is unset: for legal research intents, emit
 * explicit missingItems / riskFlags so the model must not fabricate statutes.
 * When set: HTTP GET `?q=` and map hits into ResearchSource (claims only with ids).
 */

import { randomUUID } from "node:crypto";
import type { ResearchClaim, ResearchSource, TaskIntent } from "../types.js";
import type { RetrievalAdapter, RetrievalResult } from "./index.js";

export type AuthorityHit = {
  id?: string;
  title: string;
  kind?: "statute" | "case" | "regulation" | "other";
  citation?: string;
  excerpt?: string;
  url?: string;
};

function needsAuthority(intent: TaskIntent): boolean {
  return (
    intent.kind === "research.legal" ||
    intent.kind === "research.hybrid" ||
    /\b(法条|法规|民法典|司法解释|判例|权威)\b/.test(intent.instruction ?? intent.summary ?? "")
  );
}

function mapKind(k: AuthorityHit["kind"]): ResearchSource["kind"] {
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

/**
 * Build adapter from env. Always safe to register; only flags missing corpus
 * when the intent actually needs authority.
 */
export function createAuthorityAdapterFromEnv(opts?: {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}): RetrievalAdapter {
  const endpoint = opts?.endpoint?.trim() || process.env.LAWMIND_AUTHORITY_ENDPOINT?.trim() || "";
  const fetchImpl = opts?.fetchImpl ?? fetch;

  return {
    name: "authority",
    supports: (intent) => needsAuthority(intent),
    async retrieve({ intent }): Promise<RetrievalResult> {
      if (!endpoint) {
        return {
          sources: [],
          claims: [],
          riskFlags: ["权威法律库未配置（LAWMIND_AUTHORITY_ENDPOINT）"],
          missingItems: [
            "权威法规/案例库未配置：不得编造法条编号或裁判要旨；请律师补充权威文本或配置检索端点。",
          ],
        };
      }

      const q = encodeURIComponent(intent.summary || intent.instruction || "");
      const url = `${endpoint.replace(/\/$/, "")}?q=${q}`;
      try {
        const res = await fetchImpl(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) {
          return {
            sources: [],
            claims: [],
            riskFlags: [`权威检索 HTTP ${res.status}`],
            missingItems: ["权威检索失败，请稍后重试或手动补充法条来源。"],
          };
        }
        const body = (await res.json()) as { hits?: AuthorityHit[]; items?: AuthorityHit[] };
        const rawHits = Array.isArray(body.hits)
          ? body.hits
          : Array.isArray(body.items)
            ? body.items
            : [];
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
        for (const hit of rawHits.slice(0, 20)) {
          if (!hit?.title?.trim()) {
            continue;
          }
          const id = hit.id?.trim() || randomUUID();
          sources.push({
            id,
            title: hit.title.trim(),
            kind: mapKind(hit.kind),
            url: hit.url,
            citation: hit.citation,
          });
          if (hit.excerpt?.trim()) {
            claims.push({
              text: hit.excerpt.trim().slice(0, 500),
              sourceIds: [id],
              confidence: 0.7,
              model: "legal",
            });
          }
        }
        return { sources, claims, riskFlags: [], missingItems: [] };
      } catch (e) {
        return {
          sources: [],
          claims: [],
          riskFlags: [`权威检索异常：${e instanceof Error ? e.message : String(e)}`],
          missingItems: ["权威检索不可用，请勿编造法条；请律师补充来源。"],
        };
      }
    },
  };
}
