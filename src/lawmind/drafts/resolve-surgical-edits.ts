/**
 * Resolve surgical edits from tool args, or fall back to redline-plan sidecar
 * on unlocked paths (opinion 推荐措辞 → plan → apply).
 */

import type { SurgicalTextEdit } from "./apply-surgical-edits.js";
import { parseSurgicalEditsInput } from "./apply-surgical-edits.js";
import { readRedlinePlan } from "./redline-plan.js";

export function resolveSurgicalEditsForApply(input: {
  editsArg: unknown;
  workspaceDir: string;
  taskId: string;
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): { edits: SurgicalTextEdit[]; fromPlan: boolean } {
  const locked = input.wordRevisionTurn === true || input.mailContractTurn === true;
  if (input.editsArg !== undefined) {
    try {
      const edits = parseSurgicalEditsInput(input.editsArg);
      if (edits.length > 0) {
        return { edits, fromPlan: false };
      }
    } catch (err) {
      if (locked) {
        throw err;
      }
      // Fall through to sidecar on unlocked paths.
    }
  } else if (locked) {
    throw new Error("edits 必须是非空数组，每项为 { find, replace, note? }");
  }

  const plan = readRedlinePlan(input.workspaceDir, input.taskId);
  const fromPlan = (plan?.items ?? []).map((row) => ({
    find: row.find,
    replace: row.replace,
    ...(row.note ? { note: row.note } : {}),
  }));
  if (fromPlan.length > 0) {
    return { edits: fromPlan, fromPlan: true };
  }
  throw new Error(
    locked
      ? "edits 必须是非空数组，每项为 { find, replace, note? }"
      : "edits 为空，且 drafts/<taskId>.redline-plan.json 无可用条目。请先在意见里写「原句」→「推荐措辞」，或传入 edits。",
  );
}
