import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../types.js";
import {
  buildInitialExecutionPlan,
  buildInitialExecutionPlanFromRecord,
  deriveExecutionPlanSteps,
} from "./execution-plan.js";

const baseIntent = {
  taskId: "t1",
  instruction: "x",
  summary: "s",
  riskLevel: "medium" as const,
  requiresConfirmation: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  models: [] as [],
};

describe("execution-plan", () => {
  it("buildInitialExecutionPlan adds confirm for high-friction kinds", () => {
    const steps = buildInitialExecutionPlan({
      ...baseIntent,
      kind: "draft.word",
      output: "docx",
    });
    expect(steps.some((s) => s.id === "confirm")).toBe(true);
    expect(steps.some((s) => s.id === "render")).toBe(true);
  });

  it("deriveExecutionPlanSteps marks confirm done after confirmed", () => {
    const rec: TaskRecord = {
      taskId: "t1",
      kind: "draft.word",
      summary: "s",
      output: "docx",
      riskLevel: "high",
      requiresConfirmation: true,
      status: "confirmed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      executionPlan: buildInitialExecutionPlan({
        ...baseIntent,
        kind: "draft.word",
        output: "docx",
        riskLevel: "high",
        requiresConfirmation: true,
      }),
    };
    const d = deriveExecutionPlanSteps(rec);
    expect(d.find((s) => s.id === "confirm")?.status).toBe("done");
    expect(d.find((s) => s.id === "research")?.status).toBe("pending");
  });

  it("buildInitialExecutionPlanFromRecord works without persisted plan", () => {
    const rec: TaskRecord = {
      taskId: "t2",
      kind: "research.hybrid",
      summary: "s",
      output: "markdown",
      riskLevel: "low",
      requiresConfirmation: false,
      status: "researched",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const steps = buildInitialExecutionPlanFromRecord(rec);
    expect(steps.some((s) => s.id === "research")).toBe(true);
    const d = deriveExecutionPlanSteps(rec);
    expect(d.find((s) => s.id === "research")?.status).toBe("done");
  });
});
