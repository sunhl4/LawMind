import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNorthStarSnapshot, northStarPath, persistNorthStarSnapshot } from "./north-star.js";
import { appendProductMetric } from "./product-metrics.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("north-star", () => {
  it("computes first-pass rate and leaves empty series null", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(ws, { kind: "first_pass", outcome: "fail" });
    const snap = buildNorthStarSnapshot(ws);
    expect(snap.firstPassRate).toBe(0.5);
    expect(snap.unattendedCompleteRate).toBeNull();
    expect(snap.lintEscapeRate).toBeNull();
    expect(snap.reviewDurationMsMedian).toBeNull();
  });

  it("computes median review duration from review_duration events", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-dur-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: 400 } });
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: 100 } });
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: 200 } });
    const snap = buildNorthStarSnapshot(ws);
    expect(snap.reviewDurationMsMedian).toBe(200);
  });

  it("uses even-count median and ignores non-finite durations", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-dur-even-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: 100 } });
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: 300 } });
    appendProductMetric(ws, { kind: "review_duration", outcome: "ok", meta: { durationMs: -5 } });
    const snap = buildNorthStarSnapshot(ws);
    expect(snap.reviewDurationMsMedian).toBe(200);
  });

  it("reports zero lint-escape only after the series is recorded", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-esc-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "edited_after_delivery" });
    const snap = buildNorthStarSnapshot(ws);
    expect(snap.lintEscapeRate).toBe(1);
  });

  it("persists snapshot next to product events", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-p-"));
    dirs.push(ws);
    const snap = persistNorthStarSnapshot(ws);
    expect(snap.schemaVersion).toBe(1);
    expect(snap.reviewDurationMsMedian).toBeNull();
    expect(snap.lintEscapeRate).toBeNull();
    expect(fs.existsSync(northStarPath(ws))).toBe(true);
  });
});
