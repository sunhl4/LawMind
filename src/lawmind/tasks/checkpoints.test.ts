import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../types.js";
import { listTaskCheckpoints } from "./checkpoints.js";

function baseRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    taskId: "t1",
    kind: "draft.word",
    summary: "s",
    output: "docx",
    riskLevel: "low",
    requiresConfirmation: false,
    status: "created",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("listTaskCheckpoints", () => {
  it("shows engine pipeline for draft tasks", () => {
    const cp = listTaskCheckpoints(baseRecord({ status: "researched" }));
    expect(cp.find((c) => c.id === "planned")?.reached).toBe(true);
    expect(cp.find((c) => c.id === "researched")?.reached).toBe(true);
    expect(cp.find((c) => c.id === "drafted")?.reached).toBe(false);
  });

  it("marks rejected at review step", () => {
    const cp = listTaskCheckpoints(baseRecord({ status: "rejected" }));
    const rev = cp.find((c) => c.id === "reviewed");
    expect(rev?.reached).toBe(true);
    expect(rev?.label).toContain("驳回");
  });

  it("uses short list for agent instructions", () => {
    const cp = listTaskCheckpoints(
      baseRecord({ kind: "agent.instruction", status: "completed", output: "none" }),
    );
    expect(cp).toHaveLength(2);
    expect(cp[1]?.reached).toBe(true);
  });
});
