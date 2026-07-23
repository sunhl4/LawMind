import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProductMetric } from "../metrics/product-metrics.js";
import { recordAgentReviewOutcome } from "./agent-specialization.js";
import { buildAssistantGrowthReport } from "./assistant-growth.js";
import { recordRewriteAmplitude } from "./rewrite-amplitude.js";

describe("assistant-growth", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives window rates from product events with assistantId", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-growth-"));
    recordAgentReviewOutcome({
      workspaceDir: dir,
      assistantId: "a1",
      roleId: "contract",
      firstPass: true,
    });
    recordAgentReviewOutcome({
      workspaceDir: dir,
      assistantId: "a1",
      firstPass: false,
    });
    appendProductMetric(dir, {
      kind: "first_pass",
      outcome: "ok",
      taskId: "t1",
      meta: { assistantId: "a1" },
    });
    appendProductMetric(dir, {
      kind: "rewrite",
      outcome: "modified",
      taskId: "t2",
      meta: { assistantId: "a1" },
    });
    appendProductMetric(dir, {
      kind: "first_pass",
      outcome: "ok",
      taskId: "t3",
      meta: { assistantId: "a2" },
    });

    const report = await buildAssistantGrowthReport(dir, { windowDays: 30 });
    expect(report.windowDays).toBe(30);
    const a1 = report.assistants.find((r) => r.assistantId === "a1");
    expect(a1).toBeTruthy();
    expect(a1!.lifetime.tasksReviewed).toBe(2);
    expect(a1!.lifetime.firstPassRate).toBe(0.5);
    expect(a1!.window.tasksReviewed).toBe(2);
    expect(a1!.window.firstPassRate).toBe(0.5);
    expect(a1!.roleId).toBe("contract");
  });

  it("includes rewrite amplitude averages on growth rows", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-growth-amp-"));
    recordRewriteAmplitude({
      workspaceDir: dir,
      assistantId: "a1",
      taskId: "t-amp",
      beforeText: "短",
      afterText: "短文加长很多字以便测幅度",
    });
    const report = await buildAssistantGrowthReport(dir, { windowDays: 30 });
    const a1 = report.assistants.find((r) => r.assistantId === "a1");
    expect(a1?.rewriteAmplitude?.samples).toBe(1);
    expect(a1?.rewriteAmplitude?.avgAbsCharDelta).toBeGreaterThan(0);
  });
});
