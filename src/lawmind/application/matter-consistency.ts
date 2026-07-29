/**
 * Matter JSON ↔ CASE.md consistency checks (short-term dual-truth guard).
 *
 * JSON (`matter.json`) is the truth source; CASE.md §1 is the projection.
 * Narrative CASE sections (争点/进度等) are not mirrored in JSON — not treated as drift.
 */

import fs from "node:fs/promises";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { matterJsonPath } from "../adapters/matter-storage/paths.js";
import { listMatterIds } from "../cases/index.js";
import { parseMatterDisplayNameFromCase } from "../cases/matter-label.js";
import { caseFilePath } from "../memory/index.js";
import { matterStatusLabel, projectMatterToCaseMd } from "./matter-projection.js";

export type MatterConsistencyIssueCode =
  | "missing_case_md"
  | "missing_matter_json"
  | "both_missing"
  | "title_drift"
  | "status_drift"
  | "sensitivity_drift"
  | "client_drift";

export type MatterConsistencyIssue = {
  matterId: string;
  code: MatterConsistencyIssueCode;
  message: string;
};

function parseCaseStatusLabel(caseRaw: string): string | undefined {
  const m = /(?:^|\n)-\s*当前阶段[:：]\s*([^\n]+)/.exec(caseRaw);
  const v = m?.[1]?.trim();
  return v || undefined;
}

function parseCaseSensitivityLabel(caseRaw: string): string | undefined {
  const m = /(?:^|\n)-\s*密级[:：]\s*([^\n]+)/.exec(caseRaw);
  const v = m?.[1]?.trim();
  return v || undefined;
}

function parseCaseClientId(caseRaw: string): string | undefined {
  const m = /(?:^|\n)-\s*客户\s*\/\s*clientId[:：]\s*([^\n]+)/.exec(caseRaw);
  const v = m?.[1]?.trim();
  return v || undefined;
}

const SENSITIVITY_LABELS: Record<string, string> = {
  normal: "普通保密",
  high: "高度敏感",
  restricted: "严格隔离",
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
        const caseStatus = parseCaseStatusLabel(caseRaw);
        const expectedStatus = matterStatusLabel(record.status);
        if (caseStatus && caseStatus !== expectedStatus) {
          issues.push({
            matterId,
            code: "status_drift",
            message: `CASE「当前阶段：${caseStatus}」与 matter.json.status「${expectedStatus}」不一致`,
          });
        }
        const caseSensitivity = parseCaseSensitivityLabel(caseRaw);
        const expectedSensitivity = SENSITIVITY_LABELS[record.sensitivity] ?? record.sensitivity;
        if (caseSensitivity && caseSensitivity !== expectedSensitivity) {
          issues.push({
            matterId,
            code: "sensitivity_drift",
            message: `CASE「密级：${caseSensitivity}」与 matter.json.sensitivity「${expectedSensitivity}」不一致`,
          });
        }
        const caseClient = parseCaseClientId(caseRaw);
        const jsonClient = record.clientId?.trim() || "";
        if (caseClient && jsonClient && caseClient !== jsonClient) {
          issues.push({
            matterId,
            code: "client_drift",
            message: `CASE「客户 / clientId：${caseClient}」与 matter.json.clientId「${jsonClient}」不一致`,
          });
        } else if (caseClient && !jsonClient) {
          issues.push({
            matterId,
            code: "client_drift",
            message: `CASE 有客户「${caseClient}」但 matter.json.clientId 为空（以 JSON 为准）`,
          });
        }
      }
    }
  }

  return issues;
}

/** Alias used by ops / docs — same as checkMatterConsistency. */
export const checkMatterCaseConsistency = checkMatterConsistency;

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
