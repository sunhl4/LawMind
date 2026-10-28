/**
 * Document branches for rule-level parallel review (Harvey-style).
 *
 * Workers propose EditOps on isolated branches; the parent merges.
 * Non-overlapping ops apply; overlaps become MergeConflict (never last-writer-wins).
 *
 * Borrow note (iron rule 4): AI-WorkDeck three-way merge solves parallel drafts
 * against a common ancestor. Here all workers share one base snapshot, so we
 * implement interval overlap on stable spanIds rather than porting their Java
 * version engine wholesale.
 */

import { computeMinimalEditSpans } from "./minimal-edit-script.js";

export type EditOpKind = "insert" | "delete" | "replace" | "move" | "format";

export type EditOp = {
  opId: string;
  branchId: string;
  originRuleId: string;
  originAgentId: string;
  /** Stable paragraph / fragment id (w14:paraId or ordinal+hash). */
  spanId: string;
  /** Character offsets relative to the span's plain text at baseVersion. */
  start: number;
  end: number;
  before: string;
  after: string;
  kind: EditOpKind;
  /** For move: destination span + offset. */
  moveToSpanId?: string;
  moveToStart?: number;
};

export type DocumentBranch = {
  branchId: string;
  baseVersion: string;
  ops: EditOp[];
  status: "open" | "merged" | "conflicted" | "abandoned";
};

export type MergeConflictReason = "overlap" | "same-anchor-different-intent" | "move-vs-edit";

export type MergeConflict = {
  conflictId: string;
  spanId: string;
  ops: EditOp[];
  reason: MergeConflictReason;
};

export type MergeResult = {
  merged: EditOp[];
  conflicts: MergeConflict[];
  /** Replay of non-conflicting ops on the provided base text map (optional). */
  textBySpan?: Record<string, string>;
};

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  // Half-open [start, end). Pure inserts at the same point do not overlap.
  if (aStart === aEnd && bStart === bEnd) {
    return false;
  }
  if (aStart === aEnd) {
    return aStart > bStart && aStart < bEnd;
  }
  if (bStart === bEnd) {
    return bStart > aStart && bStart < aEnd;
  }
  return aStart < bEnd && bStart < aEnd;
}

function sameIntent(a: EditOp, b: EditOp): boolean {
  return (
    a.spanId === b.spanId &&
    a.start === b.start &&
    a.end === b.end &&
    a.before === b.before &&
    a.after === b.after &&
    a.kind === b.kind
  );
}

function conflictIdFor(ops: EditOp[]): string {
  const key = ops
    .map((o) => o.opId)
    .toSorted()
    .join("+");
  return `conflict:${key}`;
}

/**
 * Merge branches that share the same baseVersion.
 * Conflicting ops are excluded from `merged` and listed in `conflicts`.
 */
export function mergeBranches(
  baseVersion: string,
  branches: readonly DocumentBranch[],
): MergeResult {
  for (const b of branches) {
    if (b.baseVersion !== baseVersion) {
      throw new Error(
        `mergeBranches: baseVersion mismatch branch=${b.branchId} expected=${baseVersion} got=${b.baseVersion}`,
      );
    }
  }

  const allOps = branches.flatMap((b) => b.ops);
  const bySpan = new Map<string, EditOp[]>();
  for (const op of allOps) {
    const list = bySpan.get(op.spanId) ?? [];
    list.push(op);
    bySpan.set(op.spanId, list);
  }

  const merged: EditOp[] = [];
  const conflicts: MergeConflict[] = [];
  const conflictedOpIds = new Set<string>();

  for (const [spanId, ops] of bySpan) {
    const sorted = [...ops].toSorted((a, b) => a.start - b.start || a.end - b.end);
    const accepted: EditOp[] = [];

    for (const op of sorted) {
      if (conflictedOpIds.has(op.opId)) {
        continue;
      }

      // move vs any other edit on same span
      if (op.kind === "move") {
        const others = sorted.filter((o) => o.opId !== op.opId && !conflictedOpIds.has(o.opId));
        if (others.length > 0) {
          const group = [op, ...others];
          for (const g of group) {
            conflictedOpIds.add(g.opId);
          }
          conflicts.push({
            conflictId: conflictIdFor(group),
            spanId,
            ops: group,
            reason: "move-vs-edit",
          });
          continue;
        }
      }

      let hit: EditOp | undefined;
      for (const prev of accepted) {
        if (!rangesOverlap(prev.start, prev.end, op.start, op.end)) {
          continue;
        }
        hit = prev;
        break;
      }

      if (!hit) {
        // Also check against other not-yet-accepted in sorted that we might skip —
        // pairwise with already accepted is enough if we process in order for non-nested.
        accepted.push(op);
        continue;
      }

      if (sameIntent(hit, op)) {
        // Deduplicate identical intents; keep the first.
        continue;
      }

      const group = [hit, op];
      for (const g of group) {
        conflictedOpIds.add(g.opId);
      }
      // Remove hit from accepted
      const idx = accepted.findIndex((a) => a.opId === hit.opId);
      if (idx >= 0) {
        accepted.splice(idx, 1);
      }
      const reason: MergeConflictReason =
        hit.start === op.start && hit.end === op.end ? "same-anchor-different-intent" : "overlap";
      conflicts.push({
        conflictId: conflictIdFor(group),
        spanId,
        ops: group,
        reason,
      });
    }

    for (const op of accepted) {
      if (!conflictedOpIds.has(op.opId)) {
        merged.push(op);
      }
    }
  }

  merged.sort((a, b) => a.spanId.localeCompare(b.spanId) || a.start - b.start);
  return { merged, conflicts };
}

/**
 * Apply non-move replace/delete/insert ops to a single span's plain text.
 * Ops must be non-overlapping and are applied right-to-left.
 */
export function replayOpsOnText(base: string, ops: readonly EditOp[]): string {
  const sorted = [...ops]
    .filter((o) => o.kind !== "move" && o.kind !== "format")
    .toSorted((a, b) => b.start - a.start || b.end - a.end);
  let text = base;
  for (const op of sorted) {
    const slice = text.slice(op.start, op.end);
    if (op.before.length > 0 && slice !== op.before) {
      throw new Error(
        `replayOpsOnText: before mismatch at ${op.start}:${op.end} expected=${JSON.stringify(op.before)} got=${JSON.stringify(slice)}`,
      );
    }
    text = text.slice(0, op.start) + op.after + text.slice(op.end);
  }
  return text;
}

/**
 * After merge, re-split each span's net change into minimal spans (iron invariant).
 * Returns empty if before === after.
 */
export function minimizeMergedSpanChange(before: string, after: string) {
  if (before === after) {
    return [];
  }
  return computeMinimalEditSpans(before, after);
}

/** Idempotent: merging the same branches twice yields the same op ids set. */
export function mergeFingerprint(result: MergeResult): string {
  const merged = result.merged
    .map((o) => o.opId)
    .toSorted()
    .join(",");
  const conflicts = result.conflicts
    .map((c) => c.conflictId)
    .toSorted()
    .join(",");
  return `${merged}|${conflicts}`;
}
