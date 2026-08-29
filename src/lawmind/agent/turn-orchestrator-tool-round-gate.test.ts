import { describe, expect, it } from "vitest";
import { extractGateDecisionFromToolResult } from "./turn-orchestrator-tool-round.js";

describe("extractGateDecisionFromToolResult", () => {
  it("extracts categorized redline hard gate", () => {
    const g = extractGateDecisionFromToolResult({
      data: {
        gateDecision: {
          gate: "redline_hunks_gate",
          decision: "block",
          reason: "empty",
          category: "safety_hard",
        },
      },
    });
    expect(g?.gate).toBe("redline_hunks_gate");
    expect(g?.category).toBe("safety_hard");
  });

  it("stamps judgment_soft for amplitude allow", () => {
    const g = extractGateDecisionFromToolResult({
      data: {
        gateDecision: {
          gate: "reasoning_gate",
          decision: "allow",
          reason: "rewrite_amplitude_soft",
        },
      },
    });
    expect(g?.decision).toBe("allow");
    expect(g?.category).toBe("judgment_soft");
  });

  it("ignores unknown gate kinds", () => {
    expect(
      extractGateDecisionFromToolResult({
        data: { gateDecision: { gate: "training_desense_gate", decision: "block" } },
      }),
    ).toBeUndefined();
  });
});
