/**
 * 创建案件工作区（cases/<matterId>/CASE.md），幂等。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { caseFilePath, ensureCaseWorkspace } from "../memory/index.js";
import { isValidMatterId } from "./matter-id.js";

export type CreateMatterResult = {
  matterId: string;
  caseFilePath: string;
  /** 本次请求是否新创建了 CASE.md（此前不存在） */
  created: boolean;
};

/**
 * 校验 matterId，若 CASE.md 不存在则创建；已存在则不覆盖内容。
 */
export async function createMatterIfAbsent(
  workspaceDir: string,
  matterId: string,
): Promise<CreateMatterResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    throw new Error("invalid matter id");
  }
  const fp = caseFilePath(workspaceDir, id);
  const existed = await fs
    .access(fp)
    .then(() => true)
    .catch(() => false);
  await ensureCaseWorkspace(workspaceDir, id);
  return {
    matterId: id,
    caseFilePath: path.resolve(fp),
    created: !existed,
  };
}
