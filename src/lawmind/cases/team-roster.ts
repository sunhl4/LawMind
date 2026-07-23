/**
 * Matter-level team roster — default meeting participants + synthesizer.
 * Persists under workspace/matters/<matterId>/team-roster.json
 */

import fs from "node:fs";
import path from "node:path";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";

export const TEAM_ROSTER_VERSION = 1 as const;

export type MatterTeamRosterV1 = {
  version: typeof TEAM_ROSTER_VERSION;
  participantAssistantIds: string[];
  synthesizerAssistantId?: string;
  updatedAt: string;
};

function rosterPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, assertSafeMatterId(matterId)), "team-roster.json");
}

export function emptyTeamRoster(): MatterTeamRosterV1 {
  return {
    version: 1,
    participantAssistantIds: [],
    updatedAt: new Date().toISOString(),
  };
}

export function readTeamRoster(workspaceDir: string, matterId: string): MatterTeamRosterV1 | null {
  const p = rosterPath(workspaceDir, matterId);
  try {
    if (!fs.existsSync(p)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MatterTeamRosterV1>;
    if (raw?.version !== 1 || !Array.isArray(raw.participantAssistantIds)) {
      return null;
    }
    const ids = raw.participantAssistantIds
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
    const synth =
      typeof raw.synthesizerAssistantId === "string"
        ? raw.synthesizerAssistantId.trim()
        : undefined;
    return {
      version: 1,
      participantAssistantIds: ids,
      synthesizerAssistantId: synth || undefined,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeTeamRoster(
  workspaceDir: string,
  matterId: string,
  input: {
    participantAssistantIds: string[];
    synthesizerAssistantId?: string | null;
  },
): MatterTeamRosterV1 {
  const mid = assertSafeMatterId(matterId);
  const ids = [
    ...new Set(
      input.participantAssistantIds
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  let synth =
    typeof input.synthesizerAssistantId === "string"
      ? input.synthesizerAssistantId.trim()
      : undefined;
  if (synth && !ids.includes(synth)) {
    synth = ids[0];
  }
  if (!synth && ids.length > 0) {
    synth = ids[0];
  }
  const next: MatterTeamRosterV1 = {
    version: 1,
    participantAssistantIds: ids,
    synthesizerAssistantId: synth,
    updatedAt: new Date().toISOString(),
  };
  const p = rosterPath(workspaceDir, mid);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
