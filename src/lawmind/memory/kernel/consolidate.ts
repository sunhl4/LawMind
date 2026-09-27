import { createHash } from "node:crypto";
import { isSingleSlotKey } from "./contract.js";
import { commitMemory } from "./gateway.js";
import { addMemoryEdge, getMemoryRecord, listMemoryRecords } from "./store.js";

function norm(text: string): string {
  return text.replace(/[\s。；;，,、]+/gu, "").trim();
}

/**
 * 同一种写法在至少两个案件里用了同一句话，才生成一条待确认的通用习惯。
 * 不自动生效。口径不同的不合并。
 */
export function consolidateRepeatedMatterHabits(workspaceDir: string): string[] {
  const rows = listMemoryRecords(workspaceDir).filter(
    (row) =>
      row.confirmation === "confirmed" &&
      row.validity === "current" &&
      row.scope === "matter" &&
      isSingleSlotKey(row.key),
  );
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = row.sourceMatterId || row.scopeId;
    if (!id) {
      continue;
    }
    const bucket = `${row.key}\n${norm(row.body)}`;
    const list = groups.get(bucket) ?? [];
    list.push(row);
    groups.set(bucket, list);
  }
  const created: string[] = [];
  for (const group of groups.values()) {
    const matters = [...new Set(group.map((row) => row.sourceMatterId || row.scopeId))];
    if (matters.length < 2) {
      continue;
    }
    const sample = group[0];
    if (!sample) {
      continue;
    }
    const body = norm(sample.body);
    const already = listMemoryRecords(workspaceDir).some(
      (row) =>
        row.scope === "lawyer" &&
        row.key === sample.key &&
        norm(row.body) === body &&
        (row.confirmation === "pending" ||
          (row.confirmation === "confirmed" && row.validity === "current") ||
          row.confirmation === "dismissed" ||
          row.validity === "revoked"),
    );
    if (already) {
      continue;
    }
    const id = `consol_${createHash("sha256").update(`${sample.key}\n${body}`).digest("hex").slice(0, 16)}`;
    if (getMemoryRecord(workspaceDir, id)) {
      continue;
    }
    const saved = commitMemory(workspaceDir, {
      id,
      kind: sample.kind === "stance" ? "stance" : "habit",
      scope: "lawyer",
      key: sample.key,
      body: sample.body,
      origin: "consolidation",
      evidenceMatterIds: matters,
      confirmNow: false,
    });
    for (const source of group) {
      addMemoryEdge(workspaceDir, saved.id, source.id, "consolidates");
    }
    created.push(saved.id);
  }
  return created;
}
