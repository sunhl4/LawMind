/**
 * First-run funnel: pending marker + audit hooks (see docs/archive/LAWMIND-DELIVERABLE-FIRST.md P5.1).
 * Last wizard completion wins if multiple runs overlap (single pending file).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import { emit } from "../audit/index.js";
import type { ArtifactDraft } from "../types.js";

export type FirstrunAcceptancePending = { matterId: string };

export type FirstrunDismissed = { dismissedAt: string };

function lawmindDir(workspaceDir: string): string {
  return path.join(workspaceDir, ".lawmind");
}

export function firstrunAcceptancePendingPath(workspaceDir: string): string {
  return path.join(lawmindDir(workspaceDir), "firstrun-acceptance-pending.json");
}

/** 首跑「不再自动打开」记在工作区，不记在浏览器。换工作区不会把上一份的关闭带过来。 */
export function firstrunDismissedPath(workspaceDir: string): string {
  return path.join(lawmindDir(workspaceDir), "firstrun-dismissed.json");
}

export async function readFirstrunAcceptancePending(
  workspaceDir: string,
): Promise<FirstrunAcceptancePending | null> {
  try {
    const raw = await fs.readFile(firstrunAcceptancePendingPath(workspaceDir), "utf8");
    const j = JSON.parse(raw) as FirstrunAcceptancePending;
    if (typeof j.matterId === "string" && j.matterId.trim()) {
      return { matterId: j.matterId.trim() };
    }
  } catch {
    // missing or invalid
  }
  return null;
}

export async function setFirstrunAcceptancePending(
  workspaceDir: string,
  matterId: string,
): Promise<void> {
  await writeFileAtomicAsync(
    firstrunAcceptancePendingPath(workspaceDir),
    `${JSON.stringify({ matterId }, null, 2)}\n`,
  );
}

export async function readFirstrunDismissed(
  workspaceDir: string,
): Promise<FirstrunDismissed | null> {
  try {
    const raw = await fs.readFile(firstrunDismissedPath(workspaceDir), "utf8");
    const j = JSON.parse(raw) as FirstrunDismissed;
    if (typeof j.dismissedAt === "string" && j.dismissedAt.trim()) {
      return { dismissedAt: j.dismissedAt.trim() };
    }
  } catch {
    // missing or invalid
  }
  return null;
}

export async function setFirstrunDismissed(
  workspaceDir: string,
  dismissedAt = new Date().toISOString(),
): Promise<void> {
  await writeFileAtomicAsync(
    firstrunDismissedPath(workspaceDir),
    `${JSON.stringify({ dismissedAt }, null, 2)}\n`,
  );
}

export async function clearFirstrunAcceptancePending(workspaceDir: string): Promise<void> {
  try {
    await fs.unlink(firstrunAcceptancePendingPath(workspaceDir));
  } catch {
    // ok
  }
}

export async function recordFirstrunWizardCompleted(
  workspaceDir: string,
  matterId: string,
  auditDir: string,
  actorId: string,
): Promise<void> {
  // 漏斗标记先落盘。审计写失败时待验收案件仍在，重试不会把首跑状态丢掉。
  await setFirstrunAcceptancePending(workspaceDir, matterId);
  await emit(auditDir, {
    taskId: matterId,
    kind: "ui.firstrun_wizard_completed",
    actor: "lawyer",
    actorId,
    detail: JSON.stringify({ matterId }),
  });
}

/**
 * When a draft passes the acceptance gate and matches pending first-run matter, emit once and clear pending.
 */
export async function maybeEmitFirstrunAcceptanceReady(
  workspaceDir: string,
  draft: ArtifactDraft,
  acceptanceReady: boolean,
  auditDir: string,
  actorId: string,
): Promise<void> {
  if (!acceptanceReady) {
    return;
  }
  const pending = await readFirstrunAcceptancePending(workspaceDir);
  if (!pending) {
    return;
  }
  if (!draft.matterId || draft.matterId !== pending.matterId) {
    return;
  }
  await emit(auditDir, {
    taskId: draft.taskId,
    kind: "ui.firstrun_acceptance_ready",
    actor: "system",
    actorId,
    detail: JSON.stringify({ matterId: draft.matterId }),
  });
  await clearFirstrunAcceptancePending(workspaceDir);
}
