/**
 * LawMind 联网检索 — Brave Web Search API（轻量实现，与 OpenClaw web_search 能力对齐）
 *
 * 环境变量（任选其一）：
 * - LAWMIND_WEB_SEARCH_API_KEY
 * - BRAVE_API_KEY（与主仓库 Brave 配置兼容）
 */

import type { AgentTool } from "../types.js";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export function resolveLawMindWebSearchApiKey(): string | undefined {
  const a = process.env.LAWMIND_WEB_SEARCH_API_KEY?.trim();
  const b = process.env.BRAVE_API_KEY?.trim();
  return a || b || undefined;
}

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveWebResponse = {
  web?: { results?: BraveWebResult[] };
};

export async function lawMindBraveWebSearch(
  query: string,
  count: number,
): Promise<Array<{ title: string; url: string; description: string }>> {
  const apiKey = resolveLawMindWebSearchApiKey();
  if (!apiKey) {
    throw new Error("missing web search API key");
  }
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave Search API error ${res.status}: ${text.slice(0, 280)}`);
  }

  const data = (await res.json()) as BraveWebResponse;
  const rows = Array.isArray(data.web?.results) ? data.web.results : [];
  return rows.slice(0, count).map((r) => ({
    title: (r.title ?? "").trim().slice(0, 400),
    url: (r.url ?? "").trim().slice(0, 2000),
    description: (r.description ?? "").trim().slice(0, 800),
  }));
}

export const lawMindWebSearchTool: AgentTool = {
  definition: {
    name: "web_search",
    description:
      "在互联网上检索公开网页摘要（Brave Search）。仅当用户在本轮对话中开启「联网检索」且已配置 API Key 时可用。用于补充工作区与本地材料之外的最新公开信息；引用前请交叉验证，不可替代官方法规或裁判文书。",
    category: "search",
    parameters: {
      query: { type: "string", description: "搜索关键词或问题", required: true },
      count: { type: "number", description: "返回条数 1-10，默认 5" },
    },
  },
  async execute(params, ctx) {
    if (!ctx.allowWebSearch) {
      return {
        ok: false,
        error:
          "联网检索未开启：请在界面勾选「允许联网检索」后，再使用本工具。未开启时仅可使用工作区与本地检索工具。",
      };
    }
    if (!resolveLawMindWebSearchApiKey()) {
      return {
        ok: false,
        error:
          "未配置联网搜索密钥：请在 .env.lawmind 中设置 LAWMIND_WEB_SEARCH_API_KEY 或 BRAVE_API_KEY（Brave Search API）。",
      };
    }
    const rawQuery = params.query;
    const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
    if (!query) {
      return { ok: false, error: "query 不能为空" };
    }
    const raw =
      typeof params.count === "number" && Number.isFinite(params.count) ? params.count : 5;
    const count = Math.min(10, Math.max(1, Math.floor(raw)));
    try {
      const results = await lawMindBraveWebSearch(query, count);
      return {
        ok: true,
        data: {
          query,
          provider: "brave",
          results,
          note: "网页摘要仅供参考，重要事实请核对原始来源。",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `联网检索失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
