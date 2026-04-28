/**
 * First-run funnel: pending marker + audit hooks (see LAWMIND-DELIVERABLE-FIRST P5.1).
 * Last wizard completion wins if multiple runs overlap (single pending file).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { emit } from "../audit/index.js";
import type { ArtifactDraft } from "../types.js";

export type FirstrunAcceptancePending = { matterId: string };

export function firstrunAcceptancePendingPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".lawmind", "firstrun-acceptance-pending.json");
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
  const dir = path.join(workspaceDir, ".lawmind");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    firstrunAcceptancePendingPath(workspaceDir),
    `${JSON.stringify({ matterId }, null, 2)}\n`,
    "utf8",
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
  await emit(auditDir, {
    taskId: matterId,
    kind: "ui.firstrun_wizard_completed",
    actor: "lawyer",
    actorId,
    detail: JSON.stringify({ matterId }),
  });
  await setFirstrunAcceptancePending(workspaceDir, matterId);
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
