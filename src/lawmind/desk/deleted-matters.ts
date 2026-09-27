/**
 * 已删除的案件编号。任务和会话里可以继续留着这个编号，
 * 但案件列表不再把它当成一卷。律师用同一编号重新建档后，这条记录作废。
 * 磁盘上如果 cases/ 或 matters/ 还在，以磁盘为准，不隐藏。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";

const REL = path.join("lawmind", "deleted-matters.json");
const CAP = 4000;

type DeletedMattersFile = { ids?: unknown };

function filePath(workspaceDir: string): string {
  return path.join(workspaceDir, REL);
}

export function loadDeletedMatterIds(workspaceDir: string): string[] {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath(workspaceDir), "utf8"),
    ) as DeletedMattersFile;
    if (!Array.isArray(parsed.ids)) {
      return [];
    }
    return parsed.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  } catch {
    return [];
  }
}

function saveDeletedMatterIds(workspaceDir: string, ids: string[]): void {
  writeJsonAtomic(filePath(workspaceDir), { ids });
}

export function rememberDeletedMatter(workspaceDir: string, matterId: string): void {
  const id = matterId.trim();
  if (!id) {
    return;
  }
  const ids = loadDeletedMatterIds(workspaceDir).filter((item) => item !== id);
  ids.push(id);
  saveDeletedMatterIds(workspaceDir, ids.slice(-CAP));
}

export function forgetDeletedMatter(workspaceDir: string, matterId: string): void {
  const id = matterId.trim();
  const ids = loadDeletedMatterIds(workspaceDir);
  if (!ids.includes(id)) {
    return;
  }
  saveDeletedMatterIds(
    workspaceDir,
    ids.filter((item) => item !== id),
  );
}

export function matterVolumeExists(workspaceDir: string, matterId: string): boolean {
  const id = matterId.trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    return false;
  }
  return (
    fs.existsSync(path.join(workspaceDir, "matters", id)) ||
    fs.existsSync(path.join(workspaceDir, "cases", id))
  );
}

/** 删过、且磁盘上已经没有这卷。 */
export function isHiddenDeletedMatter(workspaceDir: string, matterId: string): boolean {
  const id = matterId.trim();
  if (!id || matterVolumeExists(workspaceDir, id)) {
    return false;
  }
  return loadDeletedMatterIds(workspaceDir).includes(id);
}

/**
 * 会话上的案件。已删除且目录不在的编号不再钉住；显式带来的活卷可以换绑。
 */
export function resolveLiveSessionMatterId(
  workspaceDir: string,
  current: string | undefined,
  requested: string | undefined,
): string | undefined {
  const cur = current?.trim() || "";
  const req = requested?.trim() || "";
  const kept = cur && !isHiddenDeletedMatter(workspaceDir, cur) ? cur : "";
  if (req && !isHiddenDeletedMatter(workspaceDir, req)) {
    return req;
  }
  return kept || undefined;
}
