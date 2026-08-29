/**
 * Case workspace paths + CASE.md / MATTER_STRATEGY.md bootstrap.
 * Extracted so case-writes does not import memory/index (breaks the cycle).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { defaultCaseTemplate, defaultMatterStrategyTemplate } from "./templates.js";

export function caseFilePath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "CASE.md");
}

export function matterStrategyPath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "MATTER_STRATEGY.md");
}

/**
 * 为指定案件初始化工作目录与 CASE.md。
 * 仅在缺失时创建，已有内容不覆盖。
 * 同时初始化 MATTER_STRATEGY.md。
 */
export async function ensureCaseWorkspace(workspaceDir: string, matterId: string): Promise<string> {
  const filePath = caseFilePath(workspaceDir, matterId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await fs.writeFile(filePath, defaultCaseTemplate(matterId), "utf8");
  }

  const strategyPath = matterStrategyPath(workspaceDir, matterId);
  const strategyExists = await fs
    .access(strategyPath)
    .then(() => true)
    .catch(() => false);
  if (!strategyExists) {
    await fs.writeFile(strategyPath, defaultMatterStrategyTemplate(matterId), "utf8");
  }

  return filePath;
}
