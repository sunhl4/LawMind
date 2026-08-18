import { describe, expect, it } from "vitest";
import { runDeskPilot } from "./desk-pilot.js";

describe("desk pilot pack", () => {
  it("asserts scaffold gates, critic notes, sidecar bind, and unsigned outbound", async () => {
    const result = await runDeskPilot();
    expect(
      result.failed,
      result.failed.map((item) => `${item.name}: ${item.detail}`).join("\n"),
    ).toEqual([]);
    expect(result.checks.length).toBeGreaterThanOrEqual(7);
  });
});
