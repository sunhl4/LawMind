/**
 * Named world-state sections. Full inject on new session / compact;
 * later turns patch only changed sections so the static system prefix stays stable.
 */

import { createHash } from "node:crypto";

export const WORLD_STATE_SECTION_IDS = [
  "policy",
  "craft",
  "deliverable",
  "pins",
  "permission",
  "matter",
  "plan",
] as const;

export type WorldStateSectionId = (typeof WORLD_STATE_SECTION_IDS)[number];

export type WorldStateBaseline = Partial<Record<WorldStateSectionId, string>>;

export function worldStateOpenMarker(id: WorldStateSectionId): string {
  return `<!--lm-ws:${id}-->`;
}

export function worldStateCloseMarker(id: WorldStateSectionId): string {
  return `<!--/lm-ws:${id}-->`;
}

export function wrapWorldStateSection(id: WorldStateSectionId, body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  return `${worldStateOpenMarker(id)}\n${trimmed}\n${worldStateCloseMarker(id)}`;
}

function sectionPattern(id: WorldStateSectionId): RegExp {
  const open = worldStateOpenMarker(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const close = worldStateCloseMarker(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${open}\\n?([\\s\\S]*?)\\n?${close}`);
}

export function extractWorldStateSection(
  text: string,
  id: WorldStateSectionId,
): string | undefined {
  const match = sectionPattern(id).exec(text);
  return match ? (match[1] ?? "").trim() : undefined;
}

export function upsertWorldStateSection(
  text: string,
  id: WorldStateSectionId,
  body: string,
): string {
  const wrapped = wrapWorldStateSection(id, body);
  const pattern = sectionPattern(id);
  if (pattern.test(text)) {
    if (!wrapped) {
      return text
        .replace(pattern, "")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
    }
    return text.replace(pattern, wrapped);
  }
  if (!wrapped) {
    return text;
  }
  return `${text.trimEnd()}\n\n${wrapped}`;
}

export function hashWorldStateBody(body: string): string {
  return createHash("sha256").update(body.trim()).digest("hex").slice(0, 16);
}

export function collectWorldStateHashes(text: string): WorldStateBaseline {
  const out: WorldStateBaseline = {};
  for (const id of WORLD_STATE_SECTION_IDS) {
    const body = extractWorldStateSection(text, id);
    if (body !== undefined && body.length > 0) {
      out[id] = hashWorldStateBody(body);
    }
  }
  return out;
}

/**
 * When a section hash matches the previous baseline, keep the prior bytes
 * so identical pins/policy/permission do not churn the system tail.
 */
export function stabilizeUnchangedWorldState(
  assembled: string,
  previous: string | undefined,
  previousHashes: WorldStateBaseline | undefined,
  nextHashes: WorldStateBaseline,
): string {
  if (!previous || !previousHashes) {
    return assembled;
  }
  let out = assembled;
  for (const id of WORLD_STATE_SECTION_IDS) {
    const prevHash = previousHashes[id];
    if (!prevHash || prevHash !== nextHashes[id]) {
      continue;
    }
    const prevBody = extractWorldStateSection(previous, id);
    if (prevBody !== undefined) {
      out = upsertWorldStateSection(out, id, prevBody);
    }
  }
  return out;
}

export function formatPermissionWorldState(
  mode: string,
  opts?: { allowWebSearch?: boolean },
): string {
  const write = mode === "readonly" || mode === "research" ? "off" : "on";
  const network = opts?.allowWebSearch === true ? "web_search" : "off";
  return [
    "<environment>",
    `  <permission_mode>${mode}</permission_mode>`,
    `  <write_tools>${write}</write_tools>`,
    `  <network>${network}</network>`,
    "  <path_scope>workspace_roots</path_scope>",
    "  <os_sandbox>false</os_sandbox>",
    "  <turn_frozen>true</turn_frozen>",
    "</environment>",
  ].join("\n");
}

export function formatMatterWorldState(matterId: string | undefined): string {
  const id = matterId?.trim();
  return id ? `案件：${id}` : "";
}

/** Prepend a short operational fragment to the craft section (Codex-style warning). */
export function prependWorldStateCraft(systemText: string, fragment: string): string {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return systemText;
  }
  const existing = extractWorldStateSection(systemText, "craft") ?? "";
  if (existing.includes(trimmed)) {
    return existing.length > 0 ? systemText : upsertWorldStateSection(systemText, "craft", trimmed);
  }
  const merged = existing ? `${trimmed}\n\n${existing}` : trimmed;
  return upsertWorldStateSection(systemText, "craft", merged);
}

export type WorldStateCraftHost = {
  conversationHistory: Array<{ role: string; content: string }>;
  worldStateBaseline?: WorldStateBaseline;
  worldStateEpoch?: number;
  legacyUpdateDraftBodyWarning?: boolean;
};

/**
 * Consume a pending craft patch from the shared tool ctx onto the live system
 * message so the next model round in this turn sees it.
 */
export function applyPendingWorldStateCraftPatch(
  session: WorldStateCraftHost,
  ctx: { pendingWorldStateCraftPatch?: string },
): boolean {
  const patch = ctx.pendingWorldStateCraftPatch?.trim();
  if (!patch) {
    return false;
  }
  ctx.pendingWorldStateCraftPatch = undefined;
  session.legacyUpdateDraftBodyWarning = true;
  const sys = session.conversationHistory.find((m) => m.role === "system");
  if (sys) {
    sys.content = prependWorldStateCraft(sys.content, patch);
    session.worldStateBaseline = collectWorldStateHashes(sys.content);
    session.worldStateEpoch = (session.worldStateEpoch ?? 0) + 1;
  }
  return true;
}

export function appendPinIdsToWorldState(systemText: string, pinIds: string[]): string {
  if (pinIds.length === 0) {
    return systemText;
  }
  const existing = extractWorldStateSection(systemText, "pins") ?? "";
  const lines = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  for (const id of pinIds) {
    const trimmed = id.trim();
    if (!trimmed) {
      continue;
    }
    lines.add(trimmed.startsWith("- ") ? trimmed : `- ${trimmed}`);
  }
  return upsertWorldStateSection(systemText, "pins", [...lines].join("\n"));
}
