import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendProductMetric,
  listProductMetricEvents,
  summarizeProductMetrics,
} from "./product-metrics.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("product-metrics", () => {
  it("appends and summarizes events", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-metrics-"));
    dirs.push(dir);
    appendProductMetric(dir, { kind: "triage", outcome: "preview", matterId: "m1" });
    appendProductMetric(dir, { kind: "triage", outcome: "confirmed", matterId: "m1" });
    appendProductMetric(dir, {
      kind: "gate_failure",
      outcome: "checklist_incomplete",
      taskId: "t1",
    });
    appendProductMetric(dir, { kind: "first_pass", outcome: "ok", taskId: "t1" });
    appendProductMetric(dir, {
      kind: "rewrite",
      outcome: "modified",
      taskId: "t2",
      meta: { assistantId: "a1" },
    });
    const s = summarizeProductMetrics(dir);
    expect(s.total).toBe(5);
    expect(s.triagePreview).toBe(1);
    expect(s.triageConfirmed).toBe(1);
    expect(s.gateFailures).toBe(1);
    expect(s.firstPassOk).toBe(1);
    expect(s.rewrites).toBe(1);
    expect(s.firstPassFail).toBe(1);
    expect(s.truncated).toBe(false);
    expect(s.totalLines).toBe(5);
  });

  it("preserves optional runtimeEventId on product metric events", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-metrics-runtime-id-"));
    dirs.push(dir);
    appendProductMetric(dir, {
      kind: "first_pass",
      outcome: "ok",
      taskId: "t1",
      runtimeEventId: "run-123",
    });
    const events = listProductMetricEvents(dir);
    expect(events[0]?.runtimeEventId).toBe("run-123");
  });

  it("截断口径显式化：超过 limit 时标注 truncated 与窗口范围", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-metrics-trunc-"));
    dirs.push(dir);
    for (let i = 1; i <= 5; i += 1) {
      appendProductMetric(dir, { kind: "triage", outcome: `o${i}` });
    }
    const s = summarizeProductMetrics(dir, 3);
    expect(s.truncated).toBe(true);
    expect(s.totalLines).toBe(5);
    expect(s.total).toBe(3);
    // 窗口只含最近 3 条：o1/o2 在窗口外不得计入
    expect(s.byOutcome.o1).toBeUndefined();
    expect(s.byOutcome.o2).toBeUndefined();
    expect(s.byOutcome.o3).toBe(1);
    expect(s.byOutcome.o5).toBe(1);
    expect(s.windowFrom).toBeTruthy();
    expect(s.windowTo).toBeTruthy();
  });
});
