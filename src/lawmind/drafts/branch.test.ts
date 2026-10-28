import { describe, expect, it } from "vitest";
import {
  mergeBranches,
  mergeFingerprint,
  minimizeMergedSpanChange,
  replayOpsOnText,
  type DocumentBranch,
  type EditOp,
} from "./branch.js";

const BASE = "v1";

function branch(id: string, ops: EditOp[]): DocumentBranch {
  return { branchId: id, baseVersion: BASE, ops, status: "open" };
}

function op(partial: Partial<EditOp> & Pick<EditOp, "opId" | "spanId" | "start" | "end">): EditOp {
  return {
    branchId: partial.branchId ?? "b1",
    originRuleId: partial.originRuleId ?? "rule.x",
    originAgentId: partial.originAgentId ?? "agent.1",
    before: partial.before ?? "",
    after: partial.after ?? "",
    kind: partial.kind ?? "replace",
    ...partial,
  };
}

describe("mergeBranches: non-overlapping edits", () => {
  it("merges disjoint edits and replays to the correct text", () => {
    const text = "甲方应在三十日内付款，乙方应交付货物。";
    const a = op({
      opId: "a1",
      spanId: "p1",
      start: 2,
      end: 4,
      before: "应在",
      after: "须在",
      branchId: "b1",
      originRuleId: "payment.acceptance.counterparty",
    });
    const b = op({
      opId: "b1",
      spanId: "p1",
      start: 13,
      end: 16,
      before: "应交付",
      after: "须交付",
      branchId: "b2",
      originRuleId: "ip.data.counterparty",
    });

    const merged = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.merged).toHaveLength(2);
    expect(replayOpsOnText(text, merged.merged)).toBe("甲方须在三十日内付款，乙方须交付货物。");
  });

  it("deduplicates identical intents from two rules", () => {
    const a = op({ opId: "a1", spanId: "p1", start: 0, end: 2, before: "甲方", after: "买方" });
    const same = op({ opId: "b1", spanId: "p1", start: 0, end: 2, before: "甲方", after: "买方" });
    const merged = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [same])]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.merged).toHaveLength(1);
  });
});

describe("mergeBranches: conflicts are never silently resolved", () => {
  it("two different edits on the same sentence produce a conflict", () => {
    const a = op({
      opId: "a1",
      spanId: "p1",
      start: 2,
      end: 6,
      before: "应在三十",
      after: "须在六十",
      originRuleId: "payment.acceptance.counterparty",
    });
    const b = op({
      opId: "b1",
      spanId: "p1",
      start: 2,
      end: 6,
      before: "应在三十",
      after: "应于十五",
      originRuleId: "termination.symmetry.counterparty",
    });

    const merged = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].reason).toBe("same-anchor-different-intent");
    expect(merged.merged).toHaveLength(0);
  });

  it("partially overlapping ranges conflict with reason overlap", () => {
    const a = op({ opId: "a1", spanId: "p1", start: 1, end: 5, before: "1234", after: "x" });
    const b = op({ opId: "b1", spanId: "p1", start: 3, end: 7, before: "3456", after: "y" });
    const merged = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].reason).toBe("overlap");
    expect(merged.merged).toHaveLength(0);
  });

  it("move plus edit on the same span conflicts", () => {
    const move = op({
      opId: "m1",
      spanId: "p1",
      start: 0,
      end: 4,
      kind: "move",
      moveToSpanId: "p2",
      moveToStart: 0,
    });
    const edit = op({ opId: "e1", spanId: "p1", start: 6, end: 8, before: "ab", after: "cd" });
    const merged = mergeBranches(BASE, [branch("b1", [move]), branch("b2", [edit])]);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0].reason).toBe("move-vs-edit");
    expect(merged.merged).toHaveLength(0);
  });
});

describe("mergeBranches: boundaries and idempotence", () => {
  it("pure inserts at the same offset do not conflict", () => {
    const a = op({ opId: "a1", spanId: "p1", start: 3, end: 3, kind: "insert", after: "【甲】" });
    const b = op({ opId: "b1", spanId: "p1", start: 3, end: 3, kind: "insert", after: "【乙】" });
    const merged = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.merged).toHaveLength(2);
  });

  it("insert at the edge of an edited range does not conflict", () => {
    const edit = op({ opId: "a1", spanId: "p1", start: 2, end: 6, before: "2345", after: "X" });
    const boundary = op({ opId: "b1", spanId: "p1", start: 6, end: 6, kind: "insert", after: "·" });
    const merged = mergeBranches(BASE, [branch("b1", [edit]), branch("b2", [boundary])]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.merged).toHaveLength(2);
  });

  it("merge is idempotent (same fingerprint on re-merge)", () => {
    const a = op({ opId: "a1", spanId: "p1", start: 1, end: 2, before: "a", after: "b" });
    const b = op({ opId: "b1", spanId: "p1", start: 5, end: 6, before: "e", after: "f" });
    const first = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    const second = mergeBranches(BASE, [branch("b1", [a]), branch("b2", [b])]);
    expect(mergeFingerprint(first)).toBe(mergeFingerprint(second));
  });

  it("rejects branches with a different baseVersion", () => {
    const bad: DocumentBranch = {
      branchId: "b9",
      baseVersion: "v0",
      ops: [],
      status: "open",
    };
    expect(() => mergeBranches(BASE, [branch("b1", []), bad])).toThrow(/baseVersion mismatch/);
  });
});

describe("merged span stays minimal", () => {
  it("re-splits a net change into minimal spans", () => {
    const spans = minimizeMergedSpanChange(
      "甲方应在三十日内支付违约金。",
      "甲方应在六十日内支付违约金。",
    );
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.spanEnd - s.spanStart).toBeLessThan(4);
    }
  });

  it("returns empty for an unchanged span", () => {
    expect(minimizeMergedSpanChange("同一句", "同一句")).toEqual([]);
  });
});
