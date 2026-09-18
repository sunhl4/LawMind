/**
 * Firm ethics wall — persist conflict scan and hold outbound until the lawyer
 * acknowledges. Solo stays a string-scan hint (not an automatic wall).
 */

import fs from "node:fs";
import path from "node:path";
import { isValidMatterId } from "../cases/matter-id.js";
import { isFeatureEnabled } from "./edition.js";
import { readWorkspacePolicyFile } from "./workspace-policy.js";

export type EthicsWallStatus = "clear" | "hold" | "disclosed";

export type EthicsWallState = {
  scannedAt: string;
  parties: string[];
  flags: string[];
  status: EthicsWallStatus;
  disclosedAt?: string;
  disclosedBy?: string;
};

export function isEthicsWallEnabled(workspaceDir: string): boolean {
  const policy = readWorkspacePolicyFile(workspaceDir);
  if (policy?.ethicsWall?.enabled === true) {
    return true;
  }
  if (policy?.ethicsWall?.enabled === false) {
    return false;
  }
  return isFeatureEnabled("ethicsWall", { policy });
}

function wallPath(workspaceDir: string, matterId: string): string {
  return path.join(path.resolve(workspaceDir), "cases", matterId, "ethics-wall.json");
}

export function readEthicsWallState(
  workspaceDir: string,
  matterId: string | undefined,
): EthicsWallState | null {
  const id = matterId?.trim() ?? "";
  if (!isValidMatterId(id)) {
    return null;
  }
  const abs = wallPath(workspaceDir, id);
  try {
    if (!fs.existsSync(abs)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as EthicsWallState;
    if (raw?.status !== "clear" && raw?.status !== "hold" && raw?.status !== "disclosed") {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

export function writeEthicsWallState(
  workspaceDir: string,
  matterId: string,
  state: EthicsWallState,
): void {
  if (!isValidMatterId(matterId)) {
    return;
  }
  const abs = wallPath(workspaceDir, matterId);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function recordEthicsWallScan(input: {
  workspaceDir: string;
  matterId?: string;
  parties: string[];
  flags: string[];
  acknowledge?: boolean;
  actorId?: string;
}): EthicsWallState | null {
  const matterId = input.matterId?.trim() ?? "";
  if (!isValidMatterId(matterId) || !isEthicsWallEnabled(input.workspaceDir)) {
    return null;
  }
  const now = new Date().toISOString();
  const prev = readEthicsWallState(input.workspaceDir, matterId);
  if (input.acknowledge) {
    const next: EthicsWallState = {
      scannedAt: now,
      parties: input.parties,
      flags: input.flags,
      status: "disclosed",
      disclosedAt: now,
      disclosedBy: input.actorId?.trim() || prev?.disclosedBy || "lawyer",
    };
    writeEthicsWallState(input.workspaceDir, matterId, next);
    return next;
  }
  const next: EthicsWallState = {
    scannedAt: now,
    parties: input.parties,
    flags: input.flags,
    status: input.flags.length > 0 ? "hold" : "clear",
    ...(prev?.status === "disclosed" && input.flags.length === 0
      ? { disclosedAt: prev.disclosedAt, disclosedBy: prev.disclosedBy }
      : {}),
  };
  writeEthicsWallState(input.workspaceDir, matterId, next);
  return next;
}

/**
 * Lawyer-only disclosure. Model tool flags must not call this; only the
 * desktop API or a `__approved` resume after 待我拍板.
 */
export function acknowledgeEthicsWall(input: {
  workspaceDir: string;
  matterId: string;
  actorId?: string;
}): EthicsWallState | null {
  const prev = readEthicsWallState(input.workspaceDir, input.matterId);
  return recordEthicsWallScan({
    workspaceDir: input.workspaceDir,
    matterId: input.matterId,
    parties: prev?.parties ?? [],
    flags: prev?.flags ?? [],
    acknowledge: true,
    actorId: input.actorId,
  });
}

export const ETHICS_WALL_HOLD_LAWYER_MESSAGE =
  "律所伦理墙已暂停本案外发。请在「待我拍板」中确认不构成冲突或已完成客户披露后再发。";

/** True when Firm wall is on and this matter's last scan is an unresolved hold. */
export function ethicsWallBlocksOutbound(
  workspaceDir: string,
  matterId: string | undefined,
): {
  blocked: boolean;
  state: EthicsWallState | null;
} {
  if (!isEthicsWallEnabled(workspaceDir)) {
    return { blocked: false, state: null };
  }
  const state = readEthicsWallState(workspaceDir, matterId);
  if (state?.status === "hold") {
    return { blocked: true, state };
  }
  return { blocked: false, state };
}
