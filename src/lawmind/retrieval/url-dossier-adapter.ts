/**
 * Retrieval adapter: extract URLs from the instruction and fetch a provenance dossier.
 * Feeds ResearchBundle the same way as workspace/authority adapters.
 */

import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import { extractUrlsFromText, fetchUrlDossier } from "../research/url-dossier.js";
import type { RetrievalAdapter } from "./index.js";

const DOSSIER_DELIVERABLES = new Set(["report.compliance", "report.learning", "ppt.training"]);

export function createUrlDossierAdapter(workspaceDir: string): RetrievalAdapter {
  return {
    name: "url-dossier",
    supports(intent) {
      const urls = extractUrlsFromText(`${intent.instruction}\n${intent.summary ?? ""}`);
      if (urls.length === 0) {
        return false;
      }
      if (intent.deliverableType && DOSSIER_DELIVERABLES.has(intent.deliverableType)) {
        return true;
      }
      // Explicit URL lists in any research/draft task
      return (
        intent.kind === "research.hybrid" ||
        intent.kind === "research.general" ||
        intent.kind === "research.legal" ||
        intent.kind === "draft.word" ||
        intent.kind === "draft.ppt"
      );
    },
    async retrieve({ intent, signal }) {
      const urls = extractUrlsFromText(`${intent.instruction}\n${intent.summary ?? ""}`);
      if (urls.length === 0) {
        return { sources: [], claims: [], riskFlags: [], missingItems: [] };
      }
      const policy = readWorkspacePolicyFile(workspaceDir);
      const dossier = await fetchUrlDossier({
        urls,
        workspacePolicy: policy,
        maxUrls: 12,
        modelLabel: "url-dossier-adapter",
        signal,
      });
      const riskFlags: string[] = [];
      const missingItems: string[] = [];
      if (dossier.blockedCount > 0) {
        riskFlags.push(`URL 卷宗拦截 ${dossier.blockedCount} 条（SSRF/允许名单/协议）。`);
      }
      if (dossier.errorCount > 0) {
        riskFlags.push(`URL 卷宗抓取失败 ${dossier.errorCount} 条。`);
      }
      if (dossier.okCount === 0) {
        missingItems.push("指令中的 URL 未能成功抓取；请核对链接或改用权威库检索。");
      } else {
        riskFlags.push(
          `已并入 URL 卷宗 ${dossier.okCount} 条（含 hash/抓取时间）；正式意见前请核验官方效力。`,
        );
      }
      return {
        sources: dossier.sources,
        claims: dossier.claims,
        riskFlags,
        missingItems,
      };
    },
  };
}
