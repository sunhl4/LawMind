import { describe, expect, it } from "vitest";
import { resolveGateCategory, withGateCategory } from "./gate-category.js";

describe("gate-category", () => {
  it("marks approval/acceptance/dangerous as safety_hard", () => {
    expect(resolveGateCategory({ gate: "approval_gate", decision: "awaiting_confirmation" })).toBe(
      "safety_hard",
    );
    expect(resolveGateCategory({ gate: "acceptance_gate", decision: "block" })).toBe("safety_hard");
    expect(
      resolveGateCategory({ gate: "dangerous_tool_gate", decision: "awaiting_confirmation" }),
    ).toBe("safety_hard");
  });

  it("marks intake allow as judgment_soft and hard intake freeze as safety_hard", () => {
    expect(resolveGateCategory({ gate: "intake_gate", decision: "allow" })).toBe("judgment_soft");
    expect(resolveGateCategory({ gate: "intake_gate", decision: "awaiting_confirmation" })).toBe(
      "safety_hard",
    );
  });

  it("respects explicit category override", () => {
    expect(
      withGateCategory({
        gate: "intake_gate",
        decision: "awaiting_confirmation",
        category: "judgment_soft",
      }).category,
    ).toBe("judgment_soft");
  });

  it("marks empty redline as safety_hard and amplitude allow as judgment_soft", () => {
    expect(resolveGateCategory({ gate: "redline_hunks_gate", decision: "block" })).toBe(
      "safety_hard",
    );
    expect(resolveGateCategory({ gate: "surgical_span_gate", decision: "block" })).toBe(
      "safety_hard",
    );
    expect(
      resolveGateCategory({
        gate: "reasoning_gate",
        decision: "allow",
        reason: "rewrite_amplitude_soft",
      }),
    ).toBe("judgment_soft");
    expect(
      resolveGateCategory({ gate: "outbound_privilege_gate", decision: "awaiting_confirmation" }),
    ).toBe("safety_hard");
    expect(
      resolveGateCategory({
        gate: "citation_integrity_gate",
        decision: "block",
        category: "judgment_soft",
      }),
    ).toBe("judgment_soft");
  });
});
