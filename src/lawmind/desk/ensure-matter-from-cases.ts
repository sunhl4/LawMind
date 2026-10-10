/**
 * 左栏 `cases/<id>/` 已有卷宗目录，但 `matters/<id>/matter.json` 尚未登记时，
 * 打开案件管理会 404。此处在确认目录存在后幂等补登记。
 */

import fs from "node:fs";
import path from "node:path";
import { loadMatter, type MatterRecord } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";

/** 若 matter 已存在则原样返回；仅当 `cases/<id>/` 目录在盘上时才补建登记。 */
export function ensureMatterFromCasesDir(
  workspaceDir: string,
  matterId: string,
): MatterRecord | undefined {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return undefined;
  }
  const existing = loadMatter(workspaceDir, id);
  if (existing) {
    return existing;
  }
  const casesDir = path.join(path.resolve(workspaceDir), "cases", id);
  try {
    if (!fs.statSync(casesDir).isDirectory()) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return createMatterIfMissing(workspaceDir, { matterId: id, title: id });
}
