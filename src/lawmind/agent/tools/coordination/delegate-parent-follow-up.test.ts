import { describe, expect, it } from "vitest";
import type { DelegationRecord } from "../../collaboration/types.js";
import { DELEGATION_PARENT_EXCERPT_CHARS, formatDelegationParentFollowUp } from "./delegate.js";

function record(over: Partial<DelegationRecord> = {}): DelegationRecord {
  return {
    delegationId: "del-1",
    fromAssistantId: "lead",
    toAssistantId: "research",
    task: "核对指导案例",
    status: "completed",
    priority: "normal",
    depth: 1,
    startedAt: "2026-09-27T00:00:00.000Z",
    parentSessionId: "parent",
    targetSessionId: "child-1",
    ...over,
  };
}

describe("formatDelegationParentFollowUp", () => {
  it("keeps a short excerpt and points at the child session", () => {
    const body = "已核对指导案例24号。".repeat(200);
    const text = formatDelegationParentFollowUp(record(), body, true);
    expect(text).toContain("sessions/child-1.json");
    expect(text).toContain("get_delegation_result");
    expect(text).toContain("指导案例24号");
    expect(text.length).toBeLessThan(DELEGATION_PARENT_EXCERPT_CHARS + 400);
    expect(text).not.toContain(body);
  });

  it("names the spilled file when the full result is on disk", () => {
    const text = formatDelegationParentFollowUp(
      record({ resultPath: "delegations/del-1.result.md" }),
      "短回复",
      true,
    );
    expect(text).toContain("delegations/del-1.result.md");
    expect(text).toContain("短回复");
  });
});
