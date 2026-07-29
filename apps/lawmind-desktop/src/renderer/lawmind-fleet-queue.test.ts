import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import {
  fleetRunNeedsLawyer,
  fleetStatusKind,
  fleetStatusLabel,
  groupFleetQueue,
} from "./lawmind-fleet-queue";

function run(partial: Partial<AgentRunSummary> & Pick<AgentRunSummary, "id" | "status">): AgentRunSummary {
  return {
    kind: "pending_review",
    title: "t",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...partial,
  } as AgentRunSummary;
}

describe("lawmind-fleet-queue", () => {
  it("classifies statuses for lawyer queue", () => {
    expect(fleetStatusKind("awaiting_clarification")).toBe("clarify");
    expect(fleetStatusKind("awaiting_approval")).toBe("approve");
    expect(fleetStatusKind("awaiting_review")).toBe("review");
    expect(fleetStatusLabel("awaiting_review")).toBe("待签批");
    expect(fleetRunNeedsLawyer(run({ id: "1", status: "awaiting_review" }))).toBe(true);
  });

  it("groups runs and omits empty buckets", () => {
    const groups = groupFleetQueue([
      run({ id: "a", status: "awaiting_review" }),
      run({ id: "b", status: "awaiting_approval" }),
      run({ id: "c", status: "awaiting_review" }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(["review", "approve"]);
    expect(groups[0]?.items).toHaveLength(2);
    expect(groups[1]?.items).toHaveLength(1);
  });
});
