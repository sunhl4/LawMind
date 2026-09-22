/**
 * 5-minute review is prompt coaching only (do not freeze tools).
 * This flag skips “you must search / must redline” protocol blocks.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { isContractFastLaneInstruction } from "../platform/contract-fast-lane-instruction.js";

export type PromptProtocolGate = {
  instruction?: string;
  availableToolNames?: readonly string[];
  pins?: readonly ComposeContextPin[];
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
