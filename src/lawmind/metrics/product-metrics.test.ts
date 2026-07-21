import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProductMetric, summarizeProductMetrics } from "./product-metrics.js";

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
    const s = summarizeProductMetrics(dir);
    expect(s.total).toBe(4);
    expect(s.triagePreview).toBe(1);
    expect(s.triageConfirmed).toBe(1);
    expect(s.gateFailures).toBe(1);
    expect(s.firstPassOk).toBe(1);
  });
});
