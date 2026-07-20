import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMultitaskObservabilityReport } from "./multitask-observability.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("multitask-observability", () => {
  it("aggregates jobs in window", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-obs-"));
    dirs.push(ws);
    const jobsDir = path.join(ws, "lawmind", "jobs");
    fs.mkdirSync(jobsDir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(
      path.join(jobsDir, "j1.json"),
      JSON.stringify({
        status: "completed",
        createdAt: new Date(now - 60_000).toISOString(),
        completedAt: new Date(now - 30_000).toISOString(),
      }),
    );
    const report = buildMultitaskObservabilityReport({ workspaceDir: ws, windowDays: 14 });
    expect(report.sample.jobsTotal).toBe(1);
    expect(report.sample.jobsInWindow).toBe(1);
    expect(report.metrics.leadTimeP50Ms).toBe(30_000);
    expect(report.metrics.failureRate).toBe(0);
  });
});
