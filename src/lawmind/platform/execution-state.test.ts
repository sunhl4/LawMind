import { describe, expect, it } from "vitest";
import {
  executionStateFromTurn,
  isAwaitingApproval,
  isAwaitingClarification,
  mergeExecutionState,
} from "./execution-state.js";

describe("platform/execution-state", () => {
  it("maps awaiting_clarification turn status", () => {
    expect(executionStateFromTurn({ status: "awaiting_clarification" })).toMatchObject({
      phase: "clarify",
      status: "awaiting_clarification",
      recoverable: true,
    });
  });

  it("maps error turn status", () => {
    expect(executionStateFromTurn({ status: "error", error: "boom" })).toMatchObject({
      phase: "error",
      status: "failed",
      recoverable: false,
      detail: "boom",
    });
  });

  it("detects clarification from executionState", () => {
    expect(
      isAwaitingClarification({
        phase: "clarify",
        status: "awaiting_clarification",
        recoverable: true,
      }),
    ).toBe(true);
  });

  it("detects clarification from gateDecisions", () => {
    expect(
      isAwaitingClarification(undefined, [
        { gate: "clarification_gate", decision: "awaiting_confirmation" },
      ]),
    ).toBe(true);
  });

  it("detects approval from gateDecisions", () => {
    expect(
      isAwaitingApproval(undefined, [
        { gate: "dangerous_tool_gate", decision: "awaiting_confirmation" },
      ]),
    ).toBe(true);
  });

  it("mergeExecutionState patches fields", () => {
    const base = executionStateFromTurn({ status: "running" });
    expect(mergeExecutionState(base, { linkedTaskId: "task-1" }).linkedTaskId).toBe("task-1");
  });
});
