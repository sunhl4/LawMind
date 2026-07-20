import { describe, expect, it } from "vitest";
import { countActiveDelegations } from "./lawmind-records-collab-panels.js";
import type { DelegationRow } from "./lawmind-app-data";

describe("countActiveDelegations", () => {
  it("counts running and pending only", () => {
    const rows = [
      { status: "running" },
      { status: "pending" },
      { status: "completed" },
    ] as DelegationRow[];
    expect(countActiveDelegations(rows)).toBe(2);
  });
});
