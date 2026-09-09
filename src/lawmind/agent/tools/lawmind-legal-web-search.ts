/**
 * 法规 / 司法公开信息联网检索（Brave Search + 法律向查询模板）
 *
 * 与通用 `web_search` 区分：优先官方法规站点与「法律名称 + 条文」类查询。
 */

import { friendlyModelErrorMessage } from "../model-error-message.js";
import type { AgentTool } from "../types.js";
import { lawMindBraveWebSearch, resolveLawMindWebSearchApiKey } from "./lawmind-web-search.js";

const PREFERRED_LEGAL_HOSTS = [
  "npc.gov.cn",
  "www.gov.cn",
  "court.gov.cn",
  "supremecourt.gov.cn",
  "spp.gov.cn",
  "moj.gov.cn",
  "samr.gov.cn",
  "pkulaw.com",
  "chinalawinfo.com",
];

export function buildStatuteWebSearchQueries(rawQuery: string): string[] {
  const q = rawQuery.trim();
  if (!q) {
    return [];
  }
  const hasStatuteMark = /《[^》]+》|法典|条例|办法|规定|司法解释/.test(q);
  const queries = new Set<string>();
  queries.add(`${q} 法律 条文`);
  if (hasStatuteMark) {
    queries.add(`site:npc.gov.cn ${q}`);
    queries.add(`site:www.gov.cn ${q}`);
  } else {
    queries.add(`site:npc.gov.cn ${q} 法规`);
  }
  return [...queries].slice(0, 3);
}

function hostTier(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const idx = PREFERRED_LEGAL_HOSTS.findIndex((h) => host === h || host.endsWith(`.${h}`));
    return idx >= 0 ? idx : 99;
  } catch {
    return 99;
  }
}

export async function lawMindStatuteWebSearch(
  rawQuery: string,
  countPerQuery = 4,
  workspaceDir?: string,
): Promise<
  Array<{
    title: string;
    url: string;
    description: string;
    query: string;
    sourceTier: "official" | "legal_db" | "web";
  }>
> {
  const queries = buildStatuteWebSearchQueries(rawQuery);
  const merged = new Map<
    string,
    {
      title: string;
      url: string;
      description: string;
      query: string;
      sourceTier: "official" | "legal_db" | "web";
    }
  >();

  for (const query of queries) {
    const rows = await lawMindBraveWebSearch(query, countPerQuery, workspaceDir);
    for (const row of rows) {
      const key = row.url || row.title;
      if (!key || merged.has(key)) {
        continue;
      }
      const tier = hostTier(row.url);
      const sourceTier: "official" | "legal_db" | "web" =
        tier <= 5 ? "official" : tier <= 7 ? "legal_db" : "web";
      merged.set(key, { ...row, query, sourceTier });
    }
  }

  return [...merged.values()].toSorted((a, b) => hostTier(a.url) - hostTier(b.url)).slice(0, 12);
}

export const lawMindStatuteWebSearchTool: AgentTool = {
  definition: {
    name: "search_statute_web",
    description:
      "在互联网上检索法律法规、司法解释、规章的公开网页（官方法规站点优先，Brave Search）。仅当对话已开启「联网检索」且已配置 Brave Search API Key 时可用。已配置北大法宝等权威库时，应先用 `search_statute` / `search_case_law`；本工具是网页摘要兜底，不是法宝接口。结果须标注 URL 并请律师核对权威文本。",
    category: "search",
    parameters: {
      query: {
        type: "string",
        description: "法规名称、条款主题或「法律名 + 第×条」",
        required: true,
      },
      count: { type: "number", description: "期望返回条数 1-12，默认 8" },
    },
  },
  async execute(params, ctx) {
    if (!ctx.allowWebSearch) {
      return {
        ok: false,
        error: "联网检索未开启：请在对话栏开启「联网」后再使用。",
      };
    }
    if (!resolveLawMindWebSearchApiKey()) {
      return {
        ok: false,
        error:
          "未配置联网搜索密钥：请在 API 配置向导或 .env.lawmind 中设置 LAWMIND_WEB_SEARCH_API_KEY / BRAVE_API_KEY。",
      };
    }
    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const raw =
      typeof params.count === "number" && Number.isFinite(params.count) ? params.count : 8;
    const count = Math.min(12, Math.max(1, Math.floor(raw)));
    try {
      const results = await lawMindStatuteWebSearch(
        query,
        Math.min(5, Math.ceil(count / 2)),
        ctx.workspaceDir,
      );
      return {
        ok: true,
        data: {
          query,
          provider: "brave-legal",
          results: results.slice(0, count),
          note: "网页摘要仅供参考；正式引用请核对官方法规库或客户提供原文。",
        },
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: friendlyModelErrorMessage(
          rawMsg.startsWith("联网检索失败") ? rawMsg : `法规联网检索失败: ${rawMsg}`,
        ),
      };
    }
  },
};
