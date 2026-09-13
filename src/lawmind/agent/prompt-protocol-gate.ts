/**
 * Shared gates so prompt protocols match the tools actually open this turn.
 * Locked short paths must not receive contradictory “go search / go redline” blocks.
 */

import { isContractFastLaneInstruction } from "../platform/contract-fast-lane-instruction.js";

export type PromptProtocolGate = {
  instruction?: string;
  availableToolNames?: readonly string[];
};

export const RESEARCH_PROTOCOL_TOOLS = ["search_statute", "search_case_law"] as const;
export const SURGICAL_PROTOCOL_TOOLS = ["apply_surgical_edits"] as const;

export function isOpinionOnlyFastLane(instruction?: string): boolean {
  return Boolean(instruction && isContractFastLaneInstruction(instruction));
}

/** Missing list = do not infer a lock (unit tests). Empty list = nothing open. */
export function toolsAllowAny(
  names: readonly string[] | undefined,
  required: readonly string[],
): boolean {
  if (!names) {
    return true;
  }
  return required.some((n) => names.includes(n));
}
