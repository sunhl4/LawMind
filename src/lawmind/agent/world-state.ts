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

export function formatPermissionWorldState(mode: string): string {
  if (mode === "readonly" || mode === "research") {
    return `权限模式：${mode}（写工具关闭；路径仍受工作区根约束，不是「读不到 ~/.env」的 OS 沙箱。本 turn 冻结）`;
  }
  return `权限模式：${mode}（本 turn 冻结，steer 不得改写）`;
}

export function formatMatterWorldState(matterId: string | undefined): string {
  const id = matterId?.trim();
  return id ? `案件：${id}` : "";
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
