import { describe, expect, it } from "vitest";
import { BUILTIN_BENCHMARK_TASKS } from "./benchmark.js";
import { buildReleaseReadinessReportMarkdown } from "./release-report.js";

describe("release readiness report", () => {
  it("combines golden journeys, replay fixtures, benchmark status, and commands", () => {
    const report = buildReleaseReadinessReportMarkdown({
      benchmarkTasks: BUILTIN_BENCHMARK_TASKS,
      benchmarkResults: [
        {
          benchmarkId: "bm-contract-review-001",
          runId: "run-1",
          ranAt: "2026-01-01T00:00:00.000Z",
          taskCompleted: true,
          kindMatched: true,
          keywordHitRate: 1,
          riskLevelMatched: true,
          reviewGateMatched: true,
          sourceCount: 2,
          claimCount: 2,
          latencyMs: 10,
          score: 0.9,
        },
      ],
    });
    expect(report).toContain("LawMind Release Readiness Report");
    expect(report).toContain("Golden journeys: 3");
    expect(report).toContain("Replay fixtures: 12");
    expect(report).toContain("Benchmark gate: pass");
    expect(report).toContain("pnpm lawmind:verify");
  });
});
