/**
 * Helpers for deciding whether protocol coach blocks should inject.
 * No fixed “5-minute review” lane — ordinary turns keep research/surgical coaching.
 */

import type { ComposeContextPin } from "../platform/compose-context-pin.js";

export type PromptProtocolGate = {
  instruction?: string;
  availableToolNames?: readonly string[];
  pins?: readonly ComposeContextPin[];
};

export const RESEARCH_PROTOCOL_TOOLS = ["search_statute", "search_case_law"] as const;
export const SURGICAL_PROTOCOL_TOOLS = ["apply_surgical_edits"] as const;

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
