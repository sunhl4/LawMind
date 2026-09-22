/**
 * Paths for matter-replica state (additive; never touches Solo defaults).
 */

import path from "node:path";
import { assertSafeMatterId, matterDir } from "../adapters/matter-storage/paths.js";

export function replicaRoot(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, assertSafeMatterId(matterId)), "replica");
}

export function membershipPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, matterId), "membership.json");
}

export function invitesJsonlPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, matterId), "invites.jsonl");
}

export function opsJsonlPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, matterId), "ops.jsonl");
}

export function locksPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, matterId), "locks.json");
}

export function materialsIndexPath(workspaceDir: string, matterId: string): string {
  return path.join(replicaRoot(workspaceDir, matterId), "materials-index.json");
}

export function lawyerIdentityPath(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "lawyer-identity.json");
}

export function pendingInviteInboxDir(workspaceDir: string): string {
  return path.join(path.resolve(workspaceDir), "lawmind", "replica", "inbox");
}
