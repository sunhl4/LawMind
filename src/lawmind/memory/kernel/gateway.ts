import { appendLawyerProfileLearning } from "../lawyer-profile-learning.js";
import {
  isMemoryKey,
  isSingleSlotKey,
  type MemoryKernelScope,
  type MemoryKind,
  type MemoryLibraryView,
  type MemoryOrigin,
  type MemoryRecord,
} from "./contract.js";
import { restoreMemoryProjection, retractMemoryProjection } from "./retract-projection.js";
import {
  addMemoryEdge,
  getMemoryRecord,
  insertMemoryRecord,
  listCurrentSlot,
  listMemoryRecords,
  patchMemoryRecord,
  type MemoryInsert,
} from "./store.js";

export type CommitMemoryInput = {
  kind: MemoryKind;
  scope: MemoryKernelScope;
  scopeId?: string;
  key: string;
  body: string;
  origin: MemoryOrigin;
  sourceMatterId?: string;
  clientId?: string;
  counterparty?: string;
  sourceTaskId?: string;
  confidence?: number;
  evidenceMatterIds?: string[];
  /**
   * true：律师已经确认，或调用方明确要求立即生效。
   * false：只进待确认。
   * 缺省：本案事实立即生效，其余待确认。
   */
  confirmNow?: boolean;
  id?: string;
};

function confirmationFor(input: CommitMemoryInput): "pending" | "confirmed" {
  if (input.confirmNow === true) {
    return "confirmed";
  }
  if (input.confirmNow === false) {
    return "pending";
  }
  return input.kind === "matter_fact" ? "confirmed" : "pending";
}

function toInsert(input: CommitMemoryInput, confirmation: "pending" | "confirmed"): MemoryInsert {
  const body = input.body.replace(/\s+/g, " ").trim();
  if (!body) {
    throw new Error("memory_body_required");
  }
  const key = input.key.trim();
  if (!key) {
    throw new Error("memory_key_required");
  }
  return {
    ...(input.id ? { id: input.id } : {}),
    kind: input.kind,
    scope: input.scope,
    scopeId: input.scopeId?.trim() ?? "",
    key,
    body,
    confirmation,
    validity: "current",
    origin: input.origin,
    ...(input.sourceMatterId ? { sourceMatterId: input.sourceMatterId } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.counterparty ? { counterparty: input.counterparty } : {}),
    ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    ...(input.evidenceMatterIds ? { evidenceMatterIds: input.evidenceMatterIds } : {}),
  };
}

export function commitMemory(workspaceDir: string, input: CommitMemoryInput): MemoryRecord {
  const confirmation = confirmationFor(input);
  const saved = insertMemoryRecord(workspaceDir, toInsert(input, confirmation));
  if (confirmation === "confirmed" && isSingleSlotKey(saved.key)) {
    supersedeSlot(workspaceDir, saved);
  }
  return getMemoryRecord(workspaceDir, saved.id) ?? saved;
}

function supersedeSlot(workspaceDir: string, winner: MemoryRecord): void {
  const peers = listCurrentSlot(workspaceDir, winner.scope, winner.scopeId, winner.key);
  for (const peer of peers) {
    if (peer.id === winner.id) {
      continue;
    }
    patchMemoryRecord(workspaceDir, peer.id, {
      validity: "superseded",
      supersededBy: winner.id,
    });
    addMemoryEdge(workspaceDir, winner.id, peer.id, "supersedes");
    retractMemoryProjection(workspaceDir, {
      ...peer,
      validity: "superseded",
      supersededBy: winner.id,
    });
  }
}

export async function confirmMemory(
  workspaceDir: string,
  id: string,
  opts?: { body?: string; key?: string; scope?: MemoryKernelScope; scopeId?: string },
): Promise<MemoryRecord | undefined> {
  const current = getMemoryRecord(workspaceDir, id);
  if (!current || current.confirmation !== "pending" || current.validity !== "current") {
    return undefined;
  }
  const key = opts?.key?.trim() || current.key;
  if (!isMemoryKey(key)) {
    throw new Error("memory_key_invalid");
  }
  const reviewStaysOnMatter =
    opts?.scope == null &&
    current.origin === "review" &&
    Boolean(current.sourceMatterId) &&
    current.scope === "lawyer";
  const scope = reviewStaysOnMatter ? "matter" : (opts?.scope ?? current.scope);
  const scopeId = (
    reviewStaysOnMatter ? (current.sourceMatterId ?? "") : (opts?.scopeId ?? current.scopeId)
  ).trim();
  if ((scope === "matter" || scope === "client") && !scopeId) {
    throw new Error("memory_scope_required");
  }
  const kind = kindForPlacement(scope, key);
  const body = opts?.body?.trim() || current.body;
  const saved = patchMemoryRecord(workspaceDir, id, {
    confirmation: "confirmed",
    body,
    validity: "current",
    key,
    scope,
    scopeId: scope === "lawyer" || scope === "firm" ? "" : scopeId,
    kind,
  });
  if (!saved) {
    return undefined;
  }
  if (isSingleSlotKey(saved.key)) {
    supersedeSlot(workspaceDir, saved);
  }
  if (saved.kind === "habit" && saved.scope === "lawyer") {
    await appendLawyerProfileLearning(workspaceDir, saved.body, "manual").catch(() => undefined);
  }
  if (saved.scope === "matter" && isSingleSlotKey(saved.key)) {
    const { consolidateRepeatedMatterHabits } = await import("./consolidate.js");
    consolidateRepeatedMatterHabits(workspaceDir);
  }
  return getMemoryRecord(workspaceDir, id) ?? saved;
}

function kindForPlacement(scope: MemoryKernelScope, key: string): MemoryKind {
  if (scope === "matter") {
    return "matter_fact";
  }
  if (scope === "client") {
    return "client_note";
  }
  if (scope === "firm") {
    return "playbook_note";
  }
  if (key.startsWith("stance.")) {
    return "stance";
  }
  return "habit";
}

/** 把已撤回或已取代的记录重新标成当前。单槽会换下现在生效的那条。 */
export function reactivateMemory(workspaceDir: string, id: string): MemoryRecord | undefined {
  const current = getMemoryRecord(workspaceDir, id);
  if (!current) {
    return undefined;
  }
  if (current.validity === "current" && current.confirmation === "confirmed") {
    return current;
  }
  if (current.validity !== "revoked" && current.validity !== "superseded") {
    return undefined;
  }
  const saved = patchMemoryRecord(workspaceDir, id, {
    validity: "current",
    confirmation: "confirmed",
    supersededBy: null,
    revokedAt: null,
  });
  if (!saved) {
    return undefined;
  }
  if (isSingleSlotKey(saved.key)) {
    supersedeSlot(workspaceDir, saved);
  }
  return getMemoryRecord(workspaceDir, id) ?? saved;
}

export async function restoreMemory(
  workspaceDir: string,
  id: string,
): Promise<MemoryRecord | undefined> {
  const saved = reactivateMemory(workspaceDir, id);
  if (!saved) {
    return undefined;
  }
  if (saved.id.startsWith("stance_")) {
    const itemId = saved.id.slice("stance_".length);
    const { mutateStanceItems, readStanceItems } = await import("../../stance/store.js");
    if (readStanceItems(workspaceDir).some((item) => item.id === itemId && item.supersededBy)) {
      mutateStanceItems(workspaceDir, (items) =>
        items.map((item) => (item.id === itemId ? { ...item, supersededBy: undefined } : item)),
      );
    }
  }
  const current = getMemoryRecord(workspaceDir, saved.id) ?? saved;
  await restoreMemoryProjection(workspaceDir, current);
  return getMemoryRecord(workspaceDir, current.id) ?? current;
}

export function revokeMemory(workspaceDir: string, id: string): MemoryRecord | undefined {
  const current = getMemoryRecord(workspaceDir, id);
  if (!current || current.validity !== "current") {
    return undefined;
  }
  const saved = patchMemoryRecord(workspaceDir, id, {
    validity: "revoked",
    revokedAt: new Date().toISOString(),
  });
  if (saved) {
    retractMemoryProjection(workspaceDir, saved);
  }
  return saved;
}

export function dismissMemoryRecord(workspaceDir: string, id: string): MemoryRecord | undefined {
  const current = getMemoryRecord(workspaceDir, id);
  if (!current || current.confirmation !== "pending") {
    return undefined;
  }
  return patchMemoryRecord(workspaceDir, id, { confirmation: "dismissed" });
}

export function listMemoryLibrary(
  workspaceDir: string,
  view: MemoryLibraryView,
  matterId?: string,
): MemoryRecord[] {
  const matter = matterId?.trim() || "";
  return listMemoryRecords(workspaceDir).filter((row) => {
    if (view === "revoked") {
      return row.validity === "revoked" || row.validity === "superseded";
    }
    if (row.validity !== "current") {
      return false;
    }
    if (row.confirmation === "dismissed") {
      return false;
    }
    if (view === "matter") {
      if (row.scope !== "matter") {
        return false;
      }
      return matter ? row.scopeId === matter : true;
    }
    return row.scope !== "matter";
  });
}
