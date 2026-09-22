/**
 * Retrieval adapter: public web snippets (current chat model, Brave optional).
 *
 * Chat `web_search` is a separate tool the model must call. Deep research /
 * research_task previously only used workspace + authority + optional URL
 * dossier, so enabling「联网」did not actually search the public web.
 */

import { createHash } from "node:crypto";
import {
  isPublicWebSearchReady,
  lawMindPublicWebSearch,
  PUBLIC_WEB_SEARCH_UNAVAILABLE,
} from "../agent/tools/lawmind-web-search.js";
import type { WebSearchModelRef } from "../agent/tools/native-web-search.js";
import type { ResearchClaim, ResearchSource, TaskIntent } from "../types.js";
import type { RetrievalAdapter, RetrievalResult } from "./index.js";

export const BRAVE_WEB_ADAPTER_NAME = "brave-web";
export const BRAVE_WEB_PROVIDER = "brave-web";

const RESULT_COUNT = 6;

export function queryFromResearchIntent(intent: TaskIntent): string {
  const instruction = (intent.instruction ?? "").trim();
  const sub = instruction.match(/子问题：([^\n]+)\s*$/m);
  if (sub?.[1]?.trim()) {
    return sub[1].trim().replace(/\s+/g, " ").slice(0, 240);
  }
  const summary = intent.summary?.trim() ?? "";
  if (summary && summary.length <= 180) {
    return summary.replace(/\s+/g, " ");
  }
  const fallback = (summary || instruction).replace(/\s+/g, " ").trim();
  return fallback.slice(0, 240);
}

function sourceIdForUrl(url: string): string {
  return `web-${createHash("sha256").update(url).digest("hex").slice(0, 12)}`;
}

function toBundle(
  query: string,
  rows: Array<{ title: string; url: string; description: string }>,
  provider: string = BRAVE_WEB_PROVIDER,
): { sources: ResearchSource[]; claims: ResearchClaim[] } {
  const sources: ResearchSource[] = [];
  const claims: ResearchClaim[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const url = row.url.trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    const id = sourceIdForUrl(url);
    const title = (row.title.trim() || url).slice(0, 400);
    const snippet = row.description.trim().replace(/\s+/g, " ").slice(0, 800);
    sources.push({
      id,
      title,
      kind: "web",
      url,
      citation: `${title} — ${url}`,
      provider,
      licenseNote: "公开网页摘要，非正式法规库；引用前请打开 URL 核对原文。",
    });
    const text = snippet
      ? `公开网页摘要（待核验）：${title}。${snippet}`
      : `公开网页来源（待核验）：${title}`;
    claims.push({
      text: text.slice(0, 500),
      confidence: 0.42,
      sourceIds: [id],
      model: "general",
    });
  }
  if (sources.length === 0 && query) {
    return { sources, claims };
  }
  return { sources, claims };
}

export function createBraveWebSearchAdapter(
  workspaceDir: string,
  webSearchModel?: WebSearchModelRef,
): RetrievalAdapter {
  return {
    name: BRAVE_WEB_ADAPTER_NAME,
    supports: () => true,
    async retrieve({ intent, signal }): Promise<RetrievalResult> {
      const query = queryFromResearchIntent(intent);
      if (!query) {
        return { sources: [], claims: [], riskFlags: [], missingItems: [] };
      }
      if (!isPublicWebSearchReady(webSearchModel)) {
        return {
          sources: [],
          claims: [],
          riskFlags: [`公网检索：${PUBLIC_WEB_SEARCH_UNAVAILABLE}`],
          missingItems: ["在对话栏开启「联网」并确认当前模型可用后重跑"],
        };
      }
      try {
        const found = await lawMindPublicWebSearch(
          query,
          RESULT_COUNT,
          workspaceDir,
          signal,
          webSearchModel,
        );
        const provider = found.provider === "brave" ? BRAVE_WEB_PROVIDER : found.provider;
        const { sources, claims } = toBundle(query, found.results, provider);
        if (sources.length === 0) {
          return {
            sources: [],
            claims: [],
            riskFlags: [`公网检索无命中：${query.slice(0, 80)}`],
            missingItems: ["可改写检索词，或粘贴权威 URL 后重跑"],
          };
        }
        return {
          sources,
          claims,
          riskFlags: [
            `公网检索命中 ${sources.length} 条（${found.provider} 网页摘要，须核对原文）`,
          ],
          missingItems: [],
        };
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        return {
          sources: [],
          claims: [],
          riskFlags: [`公网检索失败: ${raw.slice(0, 280)}`],
          missingItems: ["检查当前模型 Key、网络允许名单或稍后重试"],
        };
      }
    },
  };
}
