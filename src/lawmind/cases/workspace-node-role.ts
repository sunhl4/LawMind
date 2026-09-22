/**
 * `cases/<matterId>/` 节点角色：正式「案件」或仅占位的「资料夹」。
 * 存 `cases/<id>/.lawmind-role.txt`，单行 `matter` 或 `folder`。
 * 无文件时：若存在 CASE.md 则视为 matter，否则 folder。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { caseFilePath } from "../memory/index.js";

export const LAWMIND_CASE_SUBDIR_ROLE_FILE = ".lawmind-role.txt";

export type CaseSubdirRole = "matter" | "folder";

function roleFromFileContent(raw: string): CaseSubdirRole | null {
  const line = raw.split(/\r?\n/)[0]?.trim().toLowerCase() ?? "";
  if (line === "folder" || line === "storage") {
    return "folder";
  }
  if (line === "matter" || line === "case") {
    return "matter";
  }
  return null;
}

export async function readCaseSubdirRole(
  workspaceDir: string,
  matterId: string,
): Promise<CaseSubdirRole> {
  const caseFp = caseFilePath(workspaceDir, matterId);
  const dir = path.dirname(caseFp);
  const fp = path.join(dir, LAWMIND_CASE_SUBDIR_ROLE_FILE);
  try {
    const raw = await fs.readFile(fp, "utf8");
    const parsed = roleFromFileContent(raw);
    if (parsed) {
      return parsed;
    }
  } catch {
    /* no role file */
  }
  try {
    await fs.access(caseFp);
    return "matter";
  } catch {
    return "folder";
  }
}

export async function writeCaseSubdirRole(
  workspaceDir: string,
  matterId: string,
  role: CaseSubdirRole,
): Promise<void> {
  const caseFp = caseFilePath(workspaceDir, matterId);
  const dir = path.dirname(caseFp);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, LAWMIND_CASE_SUBDIR_ROLE_FILE);
  const body = role === "matter" ? "matter\n" : "folder\n";
  await fs.writeFile(fp, body, "utf8");
}
