/**
 * Persist a completed 办件 as a scheduled LawyerAutomation.
 * Does not record screens or share logins — instruction + capability lock only.
 */

import {
  deskItemById,
  formatCapabilityDispatchPrompt,
  parseCapabilityLock,
} from "../skills/lawyer-capability-lock.js";
import type { LawyerCapabilityId } from "../skills/lawyer-capability-lock.js";
import type { LawyerWork } from "../work/types.js";
import {
  inferAutomationFromInstruction,
  type AutomationPresetId,
} from "./infer-automation-from-instruction.js";
import {
  createAutomation,
  type AutomationSchedule,
  type LawyerAutomation,
} from "./lawyer-automations.js";

export const DEFAULT_WORK_AUTOMATION_SCHEDULE: AutomationSchedule = {
  kind: "weekly",
  weekday: 1,
  hour: 9,
  minute: 0,
};

export function presetFromCapability(
  capabilityId?: LawyerCapabilityId,
): AutomationPresetId | undefined {
  if (capabilityId === "mail.contract") {
    return "mail-contract-review";
  }
  return undefined;
}

export function buildAutomationInstructionFromWork(
  work: Pick<LawyerWork, "title" | "goal" | "capabilityId">,
): {
  title: string;
  instruction: string;
  presetId: AutomationPresetId;
  allowSendEmailAfterApproval: boolean;
} {
  const capabilityId = work.capabilityId ?? parseCapabilityLock(`${work.goal}\n${work.title}`);
  const inferred = inferAutomationFromInstruction(work.goal.trim() || work.title);
  const presetId = presetFromCapability(capabilityId) ?? inferred.presetId;
  const desk = capabilityId ? deskItemById(capabilityId) : undefined;
  const instruction =
    capabilityId && desk
      ? formatCapabilityDispatchPrompt({
          id: capabilityId,
          label: desk.label,
          note: work.goal.trim() || work.title,
        })
      : inferred.instruction;
  const title = `例行 · ${(work.title || desk?.label || inferred.title).trim()}`.slice(0, 80);
  return {
    title,
    instruction,
    presetId,
    allowSendEmailAfterApproval: inferred.allowSendEmailAfterApproval,
  };
}

export function createAutomationFromWork(
  workspaceDir: string,
  work: LawyerWork,
  opts?: { schedule?: AutomationSchedule; matterId?: string },
): LawyerAutomation {
  const matterId = (opts?.matterId ?? work.matterId)?.trim();
  if (!matterId) {
    throw new Error("work_missing_matter");
  }
  const built = buildAutomationInstructionFromWork(work);
  return createAutomation(workspaceDir, {
    matterId,
    title: built.title,
    presetId: built.presetId,
    instruction: built.instruction,
    schedule: opts?.schedule ?? DEFAULT_WORK_AUTOMATION_SCHEDULE,
    allowSendEmailAfterApproval: built.allowSendEmailAfterApproval,
  });
}
