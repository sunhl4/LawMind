/**
 * search_precedents — 本所旧案交付物检索（对标 iManage precedent search）。
 *
 * 检索 knowledge_fts 的 precedent 语料（旧案已签批交付物摘录）。默认关闭：
 * 需 LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1（跨案读取涉及伦理墙姿态，先显式授权）。
 * 命中只作写法/口径参照——事实以本案为准，不得张冠李戴。
 */

import { isPrecedentIngestEnabled } from "../../../indexing/fts-ingest-knowledge.js";
import { searchPersonalKnowledge } from "../../../indexing/knowledge-search.js";
import type { AgentTool } from "../../types.js";

export const searchPrecedents: AgentTool = {
  definition: {
    name: "search_precedents",
    description:
      "检索本所旧案已签批交付物（意见书/合同审查/诉讼文书/函件）的可参照段落，返回旧案 ID 与章节出处。" +
      "用于写法与口径参照；旧案事实不得写入本案。需在环境开启跨案检索（LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1）。",
    category: "search",
    parameters: {
      query: { type: "string", description: "检索关键词或短语", required: true },
      limit: { type: "number", description: "返回条数上限（默认 8，最大 20）" },
    },
  },
  async execute(params, ctx) {
    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query) {
      return { ok: false, error: "缺少检索关键词 query。" };
    }
    if (!isPrecedentIngestEnabled()) {
      return {
        ok: true,
        data: {
          query,
          hits: [],
          precedentSearchEnabled: false,
          note: "先例检索未开启：跨案读取需律师显式授权（LAWMIND_ALLOW_CROSS_MATTER_SEARCH=1）。开启并重建索引后可用。",
        },
      };
    }
    const rawLimit = params.limit;
    const limit =
      typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(20, Math.floor(rawLimit))
        : 8;
    const result = await searchPersonalKnowledge(ctx.workspaceDir, {
      q: query,
      limit,
      kinds: ["precedent"],
    });
    const hits = result.hits.map((h) => ({
      matterId: h.matterId ?? "",
      section: h.section ?? "",
      snippet: h.snippet,
      citeAs: `旧案 ${h.matterId ?? "?"} · ${h.section || h.path}`,
      path: h.path,
    }));
    return {
      ok: true,
      data: {
        query,
        hits,
        precedentSearchEnabled: true,
        note: "先例只作案由与写法参照；旧案事实不得写入本案。",
        ...(result.indexMissing ? { indexMissing: true } : {}),
      },
    };
  },
};
