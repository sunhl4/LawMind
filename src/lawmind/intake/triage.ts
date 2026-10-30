/**
 * 新来件入库后的判案 + 自动归档。只有 resolveIntakeItem 判 auto_attach 时才动案件目录。
 */

import { applyIntakeFieldsFromItem } from "./field-provenance.js";
import { attachIntakeItem } from "./filing.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { resolveIntakeItem, type IntakeMatterIndex } from "./resolve.js";
import { appendIntakeEvent, intakeThreadRefs, listIntakeItems, updateIntakeItem } from "./store.js";
import { STRONG_INTAKE_KEY_KINDS, type IntakeItem } from "./types.js";

/**
 * 投进 `收件投递/<案件编号>/` 时，文件夹名只在当次扫描里当作 hint。
 * 入库后崩溃再补判时，从已记下的相对路径把这个强键找回来。
 */
function dropzoneFolderHint(item: IntakeItem): string | undefined {
  if (item.channel !== "dropzone") {
    return undefined;
  }
  const rel = item.source?.dropzoneRelPath?.replace(/\\/g, "/").trim() ?? "";
  const slash = rel.indexOf("/");
  if (slash <= 0) {
    return undefined;
  }
  const folder = rel.slice(0, slash).trim();
  if (!folder || folder === "." || folder === "..") {
    return undefined;
  }
  return folder;
}

export function triageIntakeItem(
  workspaceDir: string,
  item: IntakeItem,
  index: IntakeMatterIndex,
  opts?: { hintMatterId?: string; now?: Date },
): IntakeItem {
  if (item.status !== "pending") {
    return item;
  }
  const resolution = resolveIntakeItem(item, index, opts);
  const resolved =
    updateIntakeItem(workspaceDir, item.id, (current) =>
      current.status === "pending" ? { ...current, resolution } : undefined,
    ) ?? item;
  const top = resolution.candidates[0];
  appendIntakeEvent(workspaceDir, {
    at: resolution.resolvedAt,
    itemId: item.id,
    kind: "resolved",
    by: "system",
    ...(top ? { matterId: top.matterId } : {}),
    detail: resolution.decision,
  });
  const winner =
    resolution.decision === "auto_attach" ? resolution.candidates.find((c) => c.strong) : undefined;
  if (!winner) {
    return resolved;
  }
  const filed = attachIntakeItem(workspaceDir, item.id, winner.matterId, {
    by: "system",
    keys: winner.keys.filter((k) => STRONG_INTAKE_KEY_KINDS.has(k.kind)),
    now: opts?.now,
  });
  if (!filed.ok) {
    return resolved;
  }
  // 同一批里后到的回信能直接认上刚归档的线程。
  for (const ref of intakeThreadRefs(filed.item)) {
    index.threadRefs[ref] = winner.matterId;
  }
  return filed.item;
}

/**
 * 入库和判案之间进程被杀掉时，条目会停在 pending 且没有 resolution。
 * 每个 tick 把这种条目补判一次；已经判过、等律师处理的不再重判。
 */
export async function retriageUnfiledIntake(
  workspaceDir: string,
  opts?: { index?: IntakeMatterIndex; now?: Date; limit?: number },
): Promise<{ scanned: number; autoAttached: number }> {
  const limit = Math.max(1, Math.min(opts?.limit ?? 40, 200));
  const unfiled = listIntakeItems(workspaceDir, { statuses: ["pending"], limit: 500 }).filter(
    (item) => !item.resolution,
  );
  if (unfiled.length === 0) {
    return { scanned: 0, autoAttached: 0 };
  }
  const index = opts?.index ?? buildIntakeMatterIndex(workspaceDir);
  let scanned = 0;
  let autoAttached = 0;
  for (const item of unfiled.slice(0, limit)) {
    scanned += 1;
    const hintMatterId = dropzoneFolderHint(item);
    const triaged = triageIntakeItem(workspaceDir, item, index, {
      now: opts?.now,
      ...(hintMatterId ? { hintMatterId } : {}),
    });
    if (triaged.status !== "attached") {
      continue;
    }
    autoAttached += 1;
    const matterId = triaged.filing?.matterId;
    if (!matterId) {
      continue;
    }
    try {
      await applyIntakeFieldsFromItem(workspaceDir, matterId, triaged.id);
    } catch {
      /* 抽取是附加动作：失败不影响已经补上的归档 */
    }
  }
  return { scanned, autoAttached };
}
