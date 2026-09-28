import { describe, expect, it } from "vitest";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import { fleetBatchOutboundSends, fleetListOrderedIds } from "./lawmind-fleet-selection";

function run(partial: Partial<AgentRunSummary> & Pick<AgentRunSummary, "id">): AgentRunSummary {
  return {
    kind: "chat",
    status: "running",
    title: partial.id,
    updatedAt: "2026-09-28T00:00:00.000Z",
    createdAt: "2026-09-28T00:00:00.000Z",
    priority: 1,
    ...partial,
  };
}

describe("fleetListOrderedIds", () => {
  const docket = {
    needsYou: [{ id: "a" }, { id: "b" }],
    inFlight: [{ id: "c" }],
    settled: [{ id: "d" }],
  };

  it("skips collapsed bands", () => {
    expect(fleetListOrderedIds(docket, { inFlight: false, settled: true })).toEqual([
      "a",
      "b",
      "d",
    ]);
  });
});

describe("fleetBatchOutboundSends", () => {
  it("requires every picked row to be a pending send", () => {
    const sends = [
      run({ id: "automation-send:1", kind: "automation_send", status: "awaiting_approval" }),
      run({ id: "automation-send:2", kind: "automation_send", status: "awaiting_approval" }),
    ];
    expect(fleetBatchOutboundSends(sends)?.map((row) => row.id)).toEqual([
      "automation-send:1",
      "automation-send:2",
    ]);
    expect(fleetBatchOutboundSends(sends.slice(0, 1))).toBeNull();
    expect(fleetBatchOutboundSends([...sends, run({ id: "chat:1" })])).toBeNull();
  });
});
