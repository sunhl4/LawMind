/**
 * Matter JSON ↔ CASE.md consistency checks (short-term dual-truth guard).
 */

import fs from "node:fs/promises";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { matterJsonPath } from "../adapters/matter-storage/paths.js";
import { listMatterIds } from "../cases/index.js";
import { parseMatterDisplayNameFromCase } from "../cases/matter-label.js";
import { caseFilePath } from "../memory/index.js";
import { projectMatterToCaseMd } from "./matter-projection.js";

export type MatterConsistencyIssue = {
  matterId: string;
  code: "missing_case_md" | "missing_matter_json" | "both_missing" | "title_drift";
  message: string;
};

export async function checkMatterConsistency(
  workspaceDir: string,
): Promise<MatterConsistencyIssue[]> {
  const matterIds = await listMatterIds(workspaceDir);
  const issues: MatterConsistencyIssue[] = [];

  for (const matterId of matterIds) {
    const caseMd = caseFilePath(workspaceDir, matterId);
    const jsonPath = matterJsonPath(workspaceDir, matterId);
    const hasCase = await fs
      .access(caseMd)
      .then(() => true)
      .catch(() => false);
    const hasJson = await fs
      .access(jsonPath)
      .then(() => true)
      .catch(() => false);

    if (!hasCase && !hasJson) {
      issues.push({
        matterId,
        code: "both_missing",
        message: "既无 CASE.md 也无 matter.json",
      });
    } else if (!hasCase) {
      issues.push({
        matterId,
        code: "missing_case_md",
        message: "缺少 cases/<id>/CASE.md（Markdown 投影）",
      });
    } else if (!hasJson) {
      issues.push({
        matterId,
        code: "missing_matter_json",
        message: "缺少 matters/<id>/matter.json（JSON 真相源）",
      });
    } else {
      const record = loadMatter(workspaceDir, matterId);
      if (record) {
        const caseRaw = await fs.readFile(caseMd, "utf8").catch(() => "");
        const projectedTitle = parseMatterDisplayNameFromCase(caseRaw);
        if (projectedTitle && projectedTitle !== record.title.trim()) {
          issues.push({
            matterId,
            code: "title_drift",
            message: `CASE 展示名「${projectedTitle}」与 matter.json.title「${record.title}」不一致`,
          });
        }
      }
    }
  }

  return issues;
}

export async function repairMatterProjections(workspaceDir: string): Promise<number> {
  let repaired = 0;
  const matterIds = await listMatterIds(workspaceDir);
  for (const matterId of matterIds) {
    const record = loadMatter(workspaceDir, matterId);
    if (!record) {
      continue;
    }
    await projectMatterToCaseMd(workspaceDir, record);
    repaired += 1;
  }
  return repaired;
}

export async function formatMatterConsistencyReport(workspaceDir: string): Promise<string> {
  const issues = await checkMatterConsistency(workspaceDir);
  if (issues.length === 0) {
    return "Matter consistency: OK (all indexed matters have CASE.md + matter.json)";
  }
  const lines = issues.map((i) => `  - ${i.matterId}: [${i.code}] ${i.message}`);
  return ["Matter consistency issues:", ...lines].join("\n");
}
