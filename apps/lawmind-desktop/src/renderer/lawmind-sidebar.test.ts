import { describe, expect, it } from "vitest";
import { countActiveDelegations } from "./lawmind-sidebar.js";

describe("lawmind-sidebar", () => {
  it("counts running and pending delegations as active", () => {
    expect(
      countActiveDelegations([
        {
          delegationId: "d1",
          fromAssistant: "alpha",
          toAssistant: "beta",
          task: "review contract",
          status: "running",
          priority: "high",
          startedAt: "2026-01-01",
        },
        {
          delegationId: "d2",
          fromAssistant: "alpha",
          toAssistant: "gamma",
          task: "collect authority",
          status: "pending",
          priority: "medium",
          startedAt: "2026-01-01",
        },
        {
          delegationId: "d3",
          fromAssistant: "alpha",
          toAssistant: "delta",
          task: "draft summary",
          status: "completed",
          priority: "low",
          startedAt: "2026-01-01",
        },
      ]),
    ).toBe(2);
  });
});
