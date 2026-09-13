/**
 * Typed prompt fragments — context as a type system, not concatenated essays.
 *
 * Caps + overflow pointers keep the working desk (contract, comments, statutes)
 * in-window. Identity growth belongs on disk; this module only packs fingerprints.
 */

import { estimateTextTokens } from "./context-budget.js";
import { wrapWorldStateSection, type WorldStateSectionId } from "./world-state.js";

export type PromptFragmentKind =
  | "environment"
  | "policy"
  | "matter_index"
  | "pins"
  | "craft"
  | "skill_index"
  | "memory_hit"
  | "preference_fingerprint"
  | "deliverable"
  | "protocol"
  | "budget"
  | "turn_plan";

export type PromptFragmentPlacement = "world_state" | "session_tail" | "ephemeral";

export type PromptOverflow = {
  tool: string;
  path: string;
};

export type PromptFragment = {
  kind: PromptFragmentKind;
  placement: PromptFragmentPlacement;
  worldStateId?: WorldStateSectionId;
  priority: number;
  capTokens: number;
  overflow: PromptOverflow | null;
  body: string;
};

export const FRAGMENT_CAPS: Record<PromptFragmentKind, { capTokens: number; priority: number }> = {
  environment: { capTokens: 200, priority: 100 },
  budget: { capTokens: 80, priority: 100 },
  turn_plan: { capTokens: 220, priority: 99 },
  policy: { capTokens: 400, priority: 95 },
  pins: { capTokens: 1_200, priority: 90 },
  matter_index: { capTokens: 1_600, priority: 88 },
  deliverable: { capTokens: 400, priority: 85 },
  craft: { capTokens: 1_500, priority: 80 },
  preference_fingerprint: { capTokens: 400, priority: 72 },
  skill_index: { capTokens: 2_000, priority: 70 },
  protocol: { capTokens: 1_800, priority: 55 },
  memory_hit: { capTokens: 200, priority: 40 },
};

/** Soft budget for packed session-tail extras (world-state pinned kinds never drop). */
export const FRAGMENT_SESSION_TAIL_BUDGET_TOKENS = 12_000;

const PINNED_KINDS = new Set<PromptFragmentKind>([
  "environment",
  "budget",
  "turn_plan",
  "policy",
  "pins",
  "matter_index",
  "deliverable",
  "craft",
  "preference_fingerprint",
]);

export function formatOverflowPointer(overflow: PromptOverflow): string {
  return `…[截断，完整内容请用 ${overflow.tool} 读取 ${overflow.path}]`;
}

export function capFragmentBody(
  body: string,
  capTokens: number,
  overflow: PromptOverflow | null = null,
): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  if (!Number.isFinite(capTokens) || capTokens <= 0) {
    return overflow ? formatOverflowPointer(overflow) : "";
  }
  if (estimateTextTokens(trimmed) <= capTokens) {
    return trimmed;
  }
  const pointer = overflow
    ? `\n\n${formatOverflowPointer(overflow)}`
    : "\n\n…[截断，完整内容见工作区文件]";
  const pointerTokens = estimateTextTokens(pointer);
  const bodyBudget = Math.max(16, capTokens - pointerTokens);
  let lo = 0;
  let hi = trimmed.length;
  let best = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const slice = trimmed.slice(0, mid).trimEnd();
    if (estimateTextTokens(slice) <= bodyBudget) {
      best = slice;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return `${best}${pointer}`;
}

export function createPromptFragment(input: {
  kind: PromptFragmentKind;
  body: string;
  overflow?: PromptOverflow | null;
  placement?: PromptFragmentPlacement;
  worldStateId?: WorldStateSectionId;
  capTokens?: number;
  priority?: number;
}): PromptFragment | undefined {
  const defaults = FRAGMENT_CAPS[input.kind];
  const capped = capFragmentBody(
    input.body,
    input.capTokens ?? defaults.capTokens,
    input.overflow ?? null,
  );
  if (!capped) {
    return undefined;
  }
  const worldStateId = input.worldStateId;
  const placement = input.placement ?? (worldStateId ? "world_state" : "session_tail");
  return {
    kind: input.kind,
    placement,
    ...(worldStateId ? { worldStateId } : {}),
    priority: input.priority ?? defaults.priority,
    capTokens: input.capTokens ?? defaults.capTokens,
    overflow: input.overflow ?? null,
    body: capped,
  };
}

export function packPromptFragments(
  fragments: PromptFragment[],
  budgetTokens: number = FRAGMENT_SESSION_TAIL_BUDGET_TOKENS,
): PromptFragment[] {
  const budget =
    Number.isFinite(budgetTokens) && budgetTokens > 0
      ? budgetTokens
      : FRAGMENT_SESSION_TAIL_BUDGET_TOKENS;
  const collapsed: PromptFragment[] = [];
  let sessionCraftKept = false;
  for (const fragment of fragments) {
    if (fragment.kind === "craft" && fragment.placement !== "world_state") {
      if (sessionCraftKept) {
        continue;
      }
      sessionCraftKept = true;
    }
    collapsed.push(fragment);
  }
  const ranked = collapsed.map((fragment, index) => ({ fragment, index }));
  ranked.sort((a, b) => {
    if (b.fragment.priority !== a.fragment.priority) {
      return b.fragment.priority - a.fragment.priority;
    }
    return a.index - b.index;
  });
  const kept = new Set<PromptFragment>();
  let used = 0;
  for (const { fragment } of ranked) {
    const cost = estimateTextTokens(fragment.body);
    const pinned = PINNED_KINDS.has(fragment.kind) || fragment.placement === "world_state";
    if (pinned || kept.size === 0 || used + cost <= budget) {
      kept.add(fragment);
      used += cost;
    }
  }
  return collapsed.filter((fragment) => kept.has(fragment));
}

export function partitionPackedFragments(fragments: PromptFragment[]): {
  worldState: PromptFragment[];
  sessionTail: PromptFragment[];
} {
  const worldState: PromptFragment[] = [];
  const sessionTail: PromptFragment[] = [];
  for (const fragment of fragments) {
    if (!fragment.body || fragment.placement === "ephemeral") {
      continue;
    }
    if (fragment.placement === "world_state") {
      worldState.push(fragment);
    } else {
      sessionTail.push(fragment);
    }
  }
  return { worldState, sessionTail };
}

export function renderPackedFragments(fragments: PromptFragment[]): string[] {
  const extra: string[] = [];
  for (const fragment of fragments) {
    if (fragment.placement === "ephemeral" || !fragment.body) {
      continue;
    }
    if (fragment.placement === "world_state" && fragment.worldStateId) {
      const wrapped = wrapWorldStateSection(fragment.worldStateId, fragment.body);
      if (wrapped) {
        extra.push(`\n\n${wrapped}`);
      }
      continue;
    }
    extra.push(`\n\n${fragment.body}`);
  }
  return extra;
}

export function formatRemainingTokensNote(used: number, limit: number): string {
  const safeUsed = Math.max(0, Math.floor(used));
  const safeLimit = Math.max(1, Math.floor(limit));
  const remaining = Math.max(0, safeLimit - safeUsed);
  return `【窗口】大约还剩 ${remaining} token（已用 ${safeUsed}/${safeLimit}）。优先用工具读文件，勿整段 dump；窗口紧时先收口。`;
}

export function formatTurnContextUserMessage(tail: string | undefined): string | undefined {
  const body = tail?.trim();
  if (!body) {
    return undefined;
  }
  if (body.startsWith("<turn_context>") && body.endsWith("</turn_context>")) {
    return body;
  }
  return `<turn_context>\n${body}\n</turn_context>`;
}

export function withEphemeralTurnContext<T extends { role: string; content: string }>(
  messages: T[],
  tail: string | undefined,
): T[] {
  const wrapped = formatTurnContextUserMessage(tail);
  if (!wrapped) {
    return messages;
  }
  return [...messages, { role: "user", content: wrapped } as T];
}

export function withEphemeralBudgetNote<T extends { role: string; content: string }>(
  messages: T[],
  note: string | undefined,
): T[] {
  const trimmed = note?.trim();
  if (!trimmed) {
    return messages;
  }
  return [...messages, { role: "user", content: trimmed } as T];
}
