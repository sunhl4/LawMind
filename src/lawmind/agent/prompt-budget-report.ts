/**
 * Prompt-budget observation — what actually entered the prompt.
 *
 * The packer (`packPromptFragments`) decides which fragments survive the
 * soft fragment budget, but until now that decision was invisible: a dropped
 * protocol and a protocol that was never queued looked the same from the
 * outside, and a skill body truncated mid-sentence could only be spotted by
 * grepping the final prompt.
 *
 * This module records the decision per fragment:
 *
 * - `kept`, `dropped` (budget loss), or `duplicate_craft` (deduped by design);
 * - token estimate per fragment and the budget it competed for;
 * - whether the fragment body carries a truncation pointer.
 *
 * It is **observation only**: it never changes packing, ordering, or prompt
 * bytes. `recordPromptBudgetEvent` writes one small product-metric row per
 * turn so long-term degradation ("protocol dropped in 30% of review turns")
 * is answerable with numbers instead of impressions.
 *
 * `outcome=degraded` is reserved for real losses: a fragment dropped for
 * budget, or a Skill/protocol body truncated. Truncated pins and deduped
 * `craft` fragments are reported in `meta` but do not mark the turn degraded —
 * otherwise every heavily pinned review would trip a health alert.
 */

import { appendProductMetric } from "../metrics/product-metrics.js";
import { estimateTextTokens } from "./context-budget.js";
import { collapseSessionCraftFragments } from "./prompt-fragments.js";
import type {
  PromptFragment,
  PromptFragmentKind,
  PromptFragmentPlacement,
} from "./prompt-fragments.js";

const TRUNCATION_POINTER = /…\[[^\]]*截断/;
const LABEL_MAX_CHARS = 72;

/** Why a queued fragment did not enter the prompt. */
export type PromptBudgetDropReason = "budget" | "duplicate_craft";

export type PromptBudgetFragmentTrace = {
  /** Original queue position (stable ordering for diffs). */
  index: number;
  kind: PromptFragmentKind;
  placement: PromptFragmentPlacement;
  worldStateId?: string;
  priority: number;
  capTokens: number;
  tokens: number;
  kept: boolean;
  /** Present when the fragment was not kept; never on a kept fragment. */
  dropReason?: PromptBudgetDropReason;
  /** Body contains a truncation pointer (half a skill / capped CASE / …). */
  truncated: boolean;
  /** Structural label (heading/tag), never body text. */
  label: string;
};

export type PromptBudgetReport = {
  /** Soft fragment budget the fragments competed for (the packer's pool). */
  budgetTokens: number;
  /** Prompt-window multiplier used for this turn (1 = 128k). */
  windowScale: number;
  fragmentCount: number;
  keptCount: number;
  /** Fragments lost to the budget (a health signal). */
  droppedCount: number;
  /** Duplicate session `craft` fragments collapsed by design (not a loss). */
  collapsedCount: number;
  totalTokens: number;
  keptTokens: number;
  droppedTokens: number;
  /** Tokens that were intentionally deduped, never sent. */
  collapsedTokens: number;
  fragments: PromptBudgetFragmentTrace[];
  /** Unique kinds dropped for budget (empty when everything fit). */
  droppedKinds: PromptFragmentKind[];
  /** Headings of budget-dropped fragments — names, not bodies. */
  droppedLabels: string[];
  /** Unique kinds deduped because a session craft block was already present. */
  collapsedKinds: PromptFragmentKind[];
  /** Headings of deduped fragments — names, not bodies. */
  collapsedLabels: string[];
  /** Unique kinds whose body carries a truncation pointer. */
  truncatedKinds: PromptFragmentKind[];
};

function headingOf(body: string): string {
  // Only structural labels — never body text. Product metrics must not carry
  // lawyer content, and a fragment without a heading is identified by kind.
  const heading = /^#{1,3}\s+(.+)$/m.exec(body)?.[1]?.trim();
  const htmlTag = /^<!--[^>]+-->/.exec(body)?.[0];
  const syntheticTag = /^<[a-z_]+>/.exec(body)?.[0];
  const label = heading || htmlTag || syntheticTag || "(no heading)";
  return label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS)}…` : label;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Build a report from the fragments queued for a turn and the subset kept by
 * the packer. Pure: the returned object shares no mutable state with inputs.
 */
export function buildPromptBudgetReport(opts: {
  fragments: readonly PromptFragment[];
  packed: readonly PromptFragment[];
  budgetTokens: number;
  windowScale?: number;
}): PromptBudgetReport {
  const kept = new Set(opts.packed);
  const deduped = new Set(collapseSessionCraftFragments(opts.fragments).collapsed);
  const traces: PromptBudgetFragmentTrace[] = opts.fragments.map((fragment, index) => {
    const tokens = estimateTextTokens(fragment.body);
    const truncated = TRUNCATION_POINTER.test(fragment.body);
    const isKept = kept.has(fragment);
    const dropReason: PromptBudgetDropReason | undefined = isKept
      ? undefined
      : deduped.has(fragment)
        ? "duplicate_craft"
        : "budget";
    return {
      index,
      kind: fragment.kind,
      placement: fragment.placement,
      ...(fragment.worldStateId ? { worldStateId: fragment.worldStateId } : {}),
      priority: fragment.priority,
      capTokens: fragment.capTokens,
      tokens,
      kept: isKept,
      ...(dropReason ? { dropReason } : {}),
      truncated,
      label: headingOf(fragment.body),
    };
  });
  const dropped = traces.filter((trace) => trace.dropReason === "budget");
  const collapsed = traces.filter((trace) => trace.dropReason === "duplicate_craft");
  const keptTraces = traces.filter((trace) => trace.kept);

  return {
    budgetTokens: Math.max(0, Math.floor(opts.budgetTokens)),
    windowScale: opts.windowScale ?? 1,
    fragmentCount: traces.length,
    keptCount: keptTraces.length,
    droppedCount: dropped.length,
    collapsedCount: collapsed.length,
    totalTokens: traces.reduce((sum, trace) => sum + trace.tokens, 0),
    keptTokens: keptTraces.reduce((sum, trace) => sum + trace.tokens, 0),
    droppedTokens: dropped.reduce((sum, trace) => sum + trace.tokens, 0),
    collapsedTokens: collapsed.reduce((sum, trace) => sum + trace.tokens, 0),
    fragments: traces,
    droppedKinds: unique(dropped.map((trace) => trace.kind)),
    droppedLabels: dropped.map((trace) => `${trace.kind}:${trace.label}`),
    collapsedKinds: unique(collapsed.map((trace) => trace.kind)),
    collapsedLabels: collapsed.map((trace) => `${trace.kind}:${trace.label}`),
    truncatedKinds: unique(traces.filter((trace) => trace.truncated).map((trace) => trace.kind)),
  };
}

/**
 * Record one turn's budget decision as a product metric.
 *
 * Never throws: observability must not take down prompt assembly. Only names
 * and numbers are stored (no fragment bodies, no lawyer content).
 */
export function recordPromptBudgetEvent(
  workspaceDir: string,
  report: PromptBudgetReport,
  opts?: { matterId?: string; taskId?: string },
): void {
  try {
    // Only real losses degrade a turn. Pins are capped by design (with a
    // visible pointer), and duplicate craft blocks are alternatives.
    const criticalTruncation =
      report.truncatedKinds.includes("skill_index") || report.truncatedKinds.includes("protocol");
    appendProductMetric(workspaceDir, {
      kind: "prompt_budget",
      outcome: report.droppedCount > 0 || criticalTruncation ? "degraded" : "complete",
      ...(opts?.taskId ? { taskId: opts.taskId } : {}),
      ...(opts?.matterId ? { matterId: opts.matterId } : {}),
      meta: {
        budgetTokens: report.budgetTokens,
        windowScale: report.windowScale,
        fragmentCount: report.fragmentCount,
        keptCount: report.keptCount,
        droppedCount: report.droppedCount,
        collapsedCount: report.collapsedCount,
        totalTokens: report.totalTokens,
        keptTokens: report.keptTokens,
        droppedTokens: report.droppedTokens,
        collapsedTokens: report.collapsedTokens,
        droppedKinds: report.droppedKinds.join(","),
        droppedLabels: report.droppedLabels.slice(0, 5).join(" | "),
        collapsedKinds: report.collapsedKinds.join(","),
        truncatedKinds: report.truncatedKinds.join(","),
      },
    });
  } catch {
    /* optional */
  }
}

/** Human-readable summary for CLI / tests. One line per fragment. */
export function formatPromptBudgetReport(report: PromptBudgetReport): string {
  const pct =
    report.budgetTokens > 0
      ? `${((report.keptTokens / report.budgetTokens) * 100).toFixed(0)}%`
      : "n/a";
  const lines = [
    `prompt budget: ${report.keptTokens}/${report.budgetTokens} tokens (${pct}) · ` +
      `${report.keptCount}/${report.fragmentCount} fragments kept` +
      (report.droppedCount > 0 ? ` · ${report.droppedCount} dropped` : "") +
      (report.collapsedCount > 0 ? ` · ${report.collapsedCount} deduped` : "") +
      (report.truncatedKinds.length > 0 ? ` · truncated: ${report.truncatedKinds.join(",")}` : ""),
  ];
  for (const trace of report.fragments) {
    const state = trace.kept ? "kept" : trace.dropReason === "duplicate_craft" ? "dedup" : "DROP";
    const trunc = trace.truncated ? " trunc" : "";
    lines.push(
      `  [${state}] ${trace.kind} p${trace.priority} ${trace.tokens}/${trace.capTokens}${trunc} — ${trace.label}`,
    );
  }
  return lines.join("\n");
}
