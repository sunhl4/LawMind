import { describe, expect, it } from "vitest";
import { shouldPreApproveSandboxWorkflowStep } from "./turn-orchestrator-tool-round.js";

describe("shouldPreApproveSandboxWorkflowStep (C3)", () => {
  it("approves sandbox workflow tools when policy on and not Firm-strict", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "draft_document",
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
  });

  it("never auto-approves render or when Firm-strict", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "render_document",
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
        strictDangerousToolApproval: true,
      }),
    ).toBe(false);
  });

  it("requires policy + sandbox", () => {
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: false,
        toolSandboxEnabled: true,
        toolName: "execute_workflow",
      }),
    ).toBe(false);
    expect(
      shouldPreApproveSandboxWorkflowStep({
        autoApproveSandboxWorkflowSteps: true,
        toolSandboxEnabled: false,
        toolName: "execute_workflow",
      }),
    ).toBe(false);
  });
});
