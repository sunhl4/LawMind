/**
 * Matter JSON → CASE.md projection (§1 structured fields only).
 * JSON (`matter.json`) is the truth source; CASE.md is human-readable projection.
 */

import fs from "node:fs/promises";
import type { MatterRecord } from "../adapters/matter-storage/index.js";
import { caseFilePath, ensureCaseWorkspace, upsertMatterDisplayName } from "../memory/index.js";

const MATTER_STATUS_LABELS: Record<MatterRecord["status"], string> = {
  intake: "接案 / intake",
  active: "进行中",
  waiting_on_client: "等待客户",
  waiting_on_firm: "等待律所内部",
  under_review: "审核中",
  delivered: "已交付",
  closed: "已结案",
};

export function matterStatusLabel(status: MatterRecord["status"]): string {
  return MATTER_STATUS_LABELS[status] ?? status;
}

async function upsertCaseBasicBullet(
  workspaceDir: string,
  matterId: string,
  key: string,
  value: string,
): Promise<void> {
  await ensureCaseWorkspace(workspaceDir, matterId);
  const filePath = caseFilePath(workspaceDir, matterId);
  let raw = await fs.readFile(filePath, "utf8").catch(() => "");
  const lineBody = `${key}: ${value.replace(/\n/g, " ").trim()}`;
  const line = `- ${lineBody}`;
  const keyPattern = new RegExp(
    `\\n- ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:：][^\\n]*`,
    "g",
  );
  if (keyPattern.test(raw)) {
    raw = raw.replace(keyPattern, `\n${line}`);
  } else if (/\n- matterId:[^\n]+/.test(raw)) {
    raw = raw.replace(/(\n- matterId:[^\n]+)/, `$1\n${line}`);
  } else {
    const heading = "## 1. 基本信息";
    const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
    const match = headingPattern.exec(raw);
    if (match && match.index >= 0) {
      const insertStart = match.index + match[0].length;
      raw = `${raw.slice(0, insertStart)}\n\n${line}\n${raw.slice(insertStart)}`;
    } else {
      raw = `${raw.trimEnd()}\n\n${heading}\n\n${line}\n`;
    }
  }
  await fs.writeFile(filePath, raw, "utf8");
}

/** Project structured matter fields into CASE.md §1 (does not touch narrative sections). */
export async function projectMatterToCaseMd(
  workspaceDir: string,
  record: MatterRecord,
): Promise<void> {
  await ensureCaseWorkspace(workspaceDir, record.matterId);
  await upsertMatterDisplayName(workspaceDir, record.matterId, record.title);
  await upsertCaseBasicBullet(
    workspaceDir,
    record.matterId,
    "当前阶段",
    matterStatusLabel(record.status),
  );
}
