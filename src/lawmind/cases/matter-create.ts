/**
 * 创建案件工作区（cases/<matterId>/CASE.md），幂等。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ensureMatterWithProjection } from "../application/matter-dual-write.js";
import { caseFilePath } from "../memory/index.js";
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
  opts?: {
    displayName?: string;
    clientId?: string;
    sensitivity?: "normal" | "high" | "restricted";
    status?: "intake" | "active";
  },
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
  const dn = opts?.displayName?.trim();
  await ensureMatterWithProjection(workspaceDir, {
    matterId: id,
    ...(dn ? { title: dn } : {}),
    ...(opts?.clientId?.trim() ? { clientId: opts.clientId.trim() } : {}),
    ...(opts?.sensitivity ? { sensitivity: opts.sensitivity } : {}),
    ...(opts?.status ? { status: opts.status } : {}),
  });
  return {
    matterId: id,
    caseFilePath: path.resolve(fp),
    created: !existed,
  };
}
