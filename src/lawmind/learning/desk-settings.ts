/**
 * 桌面工作区偏好（本机 `workspace/lawmind/desk-settings.json`），与引擎任务数据分离。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";

export const DESK_SETTINGS_SCHEMA_VERSION = 1 as const;

export type LawmindDeskSettingsV1 = {
  schemaVersion: typeof DESK_SETTINGS_SCHEMA_VERSION;
  /** 相对工作区根，指向「待批量修改的合同」等材料目录；空表示未设置 */
  contractBatchRelativeDir?: string;
  /** 审计外部锚 URL：文件路径或 https:// 只写 URL，用于把可验证审计摘要同步到工作区外。 */
  auditExternalAnchorUrl?: string;
};

const REL_FILE = path.join("lawmind", "desk-settings.json");

function deskSettingsPath(workspaceDir: string): string {
  return path.join(workspaceDir, REL_FILE);
}

/** 校验相对路径：不得含 `..`、不得为绝对路径、仅使用正斜杠规范化 */
export function normalizeContractBatchRelativeDir(raw: string | undefined | null): string {
  if (raw == null) {
    return "";
  }
  const t = raw.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!t) {
    return "";
  }
  if (t.includes("..") || path.isAbsolute(t)) {
    throw new Error("invalid_contract_batch_dir");
  }
  const segs = t.split("/").filter(Boolean);
  if (segs.some((s) => s === "..")) {
    throw new Error("invalid_contract_batch_dir");
  }
  return segs.join("/");
}

export async function readDeskSettings(workspaceDir: string): Promise<LawmindDeskSettingsV1> {
  const p = deskSettingsPath(workspaceDir);
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw) as Partial<LawmindDeskSettingsV1>;
    if (j?.schemaVersion !== 1) {
      return { schemaVersion: 1 };
    }
    const out: LawmindDeskSettingsV1 = { schemaVersion: 1 };
    const dir =
      typeof j.contractBatchRelativeDir === "string" ? j.contractBatchRelativeDir.trim() : "";
    if (dir) {
      try {
        out.contractBatchRelativeDir = normalizeContractBatchRelativeDir(dir);
      } catch {
        /* drop invalid */
      }
    }
    const anchor =
      typeof j.auditExternalAnchorUrl === "string" ? j.auditExternalAnchorUrl.trim() : "";
    if (anchor) {
      out.auditExternalAnchorUrl = anchor;
    }
    return out;
  } catch {
    return { schemaVersion: 1 };
  }
}

/**
 * 写入工作区桌面设置。空值 / null / 省略 时清除对应字段。
 */
export async function writeDeskSettings(
  workspaceDir: string,
  partial: { contractBatchRelativeDir?: string | null; auditExternalAnchorUrl?: string | null },
): Promise<LawmindDeskSettingsV1> {
  const next: LawmindDeskSettingsV1 = { schemaVersion: 1 };
  const rawDir = partial.contractBatchRelativeDir;
  if (rawDir != null && String(rawDir).trim() !== "") {
    next.contractBatchRelativeDir = normalizeContractBatchRelativeDir(String(rawDir));
  }
  const rawAnchor = partial.auditExternalAnchorUrl;
  if (rawAnchor != null && String(rawAnchor).trim() !== "") {
    next.auditExternalAnchorUrl = String(rawAnchor).trim();
  }
  await writeFileAtomicAsync(deskSettingsPath(workspaceDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
