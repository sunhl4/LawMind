/**
 * `workspace/matters/<matterId>/` JSON 真相源的路径计算（W3）。
 *
 * 与现有 `cases/<matterId>/CASE.md` 并存：CASE.md 仍是律师可读的叙事文件，
 * 本目录是机器可读的状态对象。
 */

import path from "node:path";

const ALLOWED_MATTER_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function assertSafeMatterId(matterId: string): string {
  const trimmed = matterId.trim();
  if (!ALLOWED_MATTER_ID.test(trimmed)) {
    throw new Error(`unsafe matter id: ${matterId}`);
  }
  return trimmed;
}

export function matterStorageRoot(workspaceDir: string): string {
  return path.join(workspaceDir, "matters");
}

export function matterDir(workspaceDir: string, matterId: string): string {
  return path.join(matterStorageRoot(workspaceDir), assertSafeMatterId(matterId));
}

export function matterJsonPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "matter.json");
}

export function deliverablesDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "deliverables");
}

export function deliverableJsonPath(
  workspaceDir: string,
  matterId: string,
  deliverableId: string,
): string {
  const safe = assertSafeMatterId(deliverableId);
  return path.join(deliverablesDir(workspaceDir, matterId), `${safe}.json`);
}

export function approvalsJsonlPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "approvals.jsonl");
}

export function queueJsonlPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "queue.jsonl");
}

export function deadlinesJsonlPath(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "deadlines.jsonl");
}
