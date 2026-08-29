/**
 * Agent tool: fetch a URL list into a provenance-backed dossier and merge into ResearchBundle.
 */

import { persistResearchSnapshot, readResearchSnapshot } from "../../drafts/research-snapshot.js";
import { readWorkspacePolicyFile } from "../../policy/workspace-policy.js";
import {
  extractUrlsFromText,
  fetchUrlDossier,
  mergeDossierIntoBundleParts,
  parseUrlList,
  type UrlDossierResult,
} from "../../research/url-dossier.js";
import type { ResearchBundle } from "../../types.js";
import { friendlyModelErrorMessage } from "../model-error-message.js";
import type { AgentTool } from "../types.js";

function formatDossierMarkdown(result: UrlDossierResult): string {
  const lines = [
    `# URL 卷宗`,
    "",
    `成功 ${result.okCount} · 拦截 ${result.blockedCount} · 失败 ${result.errorCount}`,
    "",
  ];
  for (const e of result.entries) {
    lines.push(`## ${e.title ?? e.url}`);
    lines.push(`- URL: ${e.url}`);
    lines.push(`- 状态: ${e.status}`);
    if (e.contentHash) {
      lines.push(`- hash: ${e.contentHash}`);
    }
    if (e.sourceId) {
      lines.push(`- sourceId: ${e.sourceId}`);
    }
    if (e.error) {
      lines.push(`- 错误: ${e.error}`);
    }
    if (e.textExcerpt) {
      lines.push("", e.textExcerpt.slice(0, 1200), "");
    }
  }
  return lines.join("\n").trim();
}

function mergeIntoTaskSnapshot(
  workspaceDir: string,
  taskId: string,
  dossier: UrlDossierResult,
): ResearchBundle {
  const existing = readResearchSnapshot(workspaceDir, taskId);
  const base: ResearchBundle = existing ?? {
    taskId,
    query: "url_dossier",
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: true,
    completedAt: new Date().toISOString(),
  };
  const merged = mergeDossierIntoBundleParts(base, dossier);
  const next: ResearchBundle = {
    ...base,
    sources: merged.sources,
    claims: merged.claims,
    riskFlags: [
      ...base.riskFlags,
      ...(dossier.okCount > 0 ? [`url_dossier 并入 ${dossier.okCount} 条来源`] : []),
    ],
    requiresReview: true,
    completedAt: new Date().toISOString(),
  };
  persistResearchSnapshot(workspaceDir, next);
  return next;
}

export const lawMindUrlDossierTool: AgentTool = {
  definition: {
    name: "url_dossier",
    description:
      "抓取律师提供的 URL 列表为合规研究卷宗（hash/时间戳/摘录）。若提供 task_id，将 sources/claims 合并进该任务的 ResearchBundle，供后续 draft_document 引用。受 SSRF 与网络允许名单约束。",
    category: "search",
    parameters: {
      urls: {
        type: "string",
        description: "URL 列表（换行/逗号分隔）或含 URL 的文本",
        required: true,
      },
      task_id: {
        type: "string",
        description: "可选：合并进该任务的 research snapshot",
      },
      max_urls: {
        type: "number",
        description: "最多抓取条数 1-20，默认 10",
      },
    },
  },
  async execute(params, ctx) {
    if (!ctx.allowWebSearch) {
      return {
        ok: false,
        error: "未开启联网检索，无法抓取 URL 卷宗。请在本轮对话开启「联网检索」。",
      };
    }
    const urlsRaw = typeof params.urls === "string" ? params.urls : "";
    const urls = parseUrlList(urlsRaw).length
      ? parseUrlList(urlsRaw)
      : extractUrlsFromText(urlsRaw);
    if (urls.length === 0) {
      return { ok: false, error: "请提供至少一个合法 URL。" };
    }
    const maxUrls = Math.min(
      20,
      Math.max(1, typeof params.max_urls === "number" ? Math.floor(params.max_urls) : 10),
    );
    const taskId =
      typeof params.task_id === "string" && params.task_id.trim()
        ? params.task_id.trim()
        : ctx.linkedTaskId?.trim() || undefined;
    try {
      const policy = readWorkspacePolicyFile(ctx.workspaceDir);
      const result = await fetchUrlDossier({
        urls,
        workspacePolicy: policy,
        maxUrls,
        modelLabel: "url_dossier",
        signal: ctx.abortSignal,
      });
      let bundleSummary: { sources: number; claims: number } | undefined;
      if (taskId && result.okCount > 0) {
        const bundle = mergeIntoTaskSnapshot(ctx.workspaceDir, taskId, result);
        bundleSummary = { sources: bundle.sources.length, claims: bundle.claims.length };
      }
      if (result.okCount === 0) {
        return {
          ok: false,
          error: `未能成功抓取任何页面（拦截 ${result.blockedCount}，失败 ${result.errorCount}）。`,
          data: {
            markdown: formatDossierMarkdown(result),
            okCount: result.okCount,
            blockedCount: result.blockedCount,
            errorCount: result.errorCount,
            sources: result.sources,
            claims: result.claims,
          },
        };
      }
      return {
        ok: true,
        data: {
          markdown: formatDossierMarkdown(result),
          okCount: result.okCount,
          blockedCount: result.blockedCount,
          errorCount: result.errorCount,
          sources: result.sources,
          claims: result.claims,
          sourceIds: result.sources.map((s) => s.id),
          mergedIntoTaskId: taskId,
          bundleSummary,
          note: "卷宗已结构化；若已合并 task_id，可直接 draft_document 引用 citations。",
        },
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: friendlyModelErrorMessage(
          raw.startsWith("URL 卷宗") ? raw : `URL 卷宗抓取失败: ${raw}`,
        ),
      };
    }
  },
};
