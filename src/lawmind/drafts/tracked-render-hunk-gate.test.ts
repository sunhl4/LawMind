import { describe, expect, it } from "vitest";
import { evaluateTrackedRenderHunkGate } from "./tracked-render-hunk-gate.js";

describe("evaluateTrackedRenderHunkGate", () => {
  it("passes when no contractEdit baseline path", () => {
    expect(evaluateTrackedRenderHunkGate({ hasContractEdit: false, proposalCount: 0 }).ok).toBe(
      true,
    );
  });

  it("blocks contractEdit with zero hunks", () => {
    const gate = evaluateTrackedRenderHunkGate({
      hasContractEdit: true,
      proposalCount: 0,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe("redline_hunks_required");
      expect(gate.message).toContain("redlinePending");
    }
  });

  it("passes when at least one hunk exists", () => {
    expect(evaluateTrackedRenderHunkGate({ hasContractEdit: true, proposalCount: 1 }).ok).toBe(
      true,
    );
  });

  it("allowEmpty bypasses the gate", () => {
    expect(
      evaluateTrackedRenderHunkGate({
        hasContractEdit: true,
        proposalCount: 0,
        allowEmpty: true,
      }).ok,
    ).toBe(true);
  });
});
