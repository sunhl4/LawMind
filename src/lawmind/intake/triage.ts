/**
 * 新来件入库后的判案 + 自动归档。只有 resolveIntakeItem 判 auto_attach 时才动案件目录。
 */

import { attachIntakeItem } from "./filing.js";
import { resolveIntakeItem, type IntakeMatterIndex } from "./resolve.js";
import { appendIntakeEvent, intakeThreadRefs, updateIntakeItem } from "./store.js";
import { STRONG_INTAKE_KEY_KINDS, type IntakeItem } from "./types.js";

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
