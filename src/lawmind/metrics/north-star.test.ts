import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildNorthStarSnapshot,
  northStarPath,
  persistNorthStarSnapshot,
  readNorthStarSnapshot,
} from "./north-star.js";
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
    // v2：有 1 个已交付样本且零 lawyer_edit 逃逸 → 如实 0%，不再是 null/100%
    expect(snap.lintEscapeRate).toBe(0);
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

  it("v2 口径：rewrite 计入分母，escape 仅计 lawyer_edit", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-esc-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(ws, { kind: "rewrite", outcome: "modified" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    // lint_findings 是草稿侧信号，不计逃逸
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lint_findings" });
    const snap = buildNorthStarSnapshot(ws);
    // 分母 = first_pass(1) + rewrite(1) = 2；逃逸 = lawyer_edit(1) → 0.5
    expect(snap.samples.deliveries).toBe(2);
    expect(snap.samples.lintEscapes).toBe(1);
    expect(snap.lintEscapeRate).toBe(0.5);
  });

  it("v2 口径：零已交付样本时 lintEscapeRate 保持诚实 null", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-empty-"));
    dirs.push(ws);
    // 只有逃逸事件、没有任何已交付任务：分母为 0，不得编造 100% 或 0%
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    const snap = buildNorthStarSnapshot(ws);
    expect(snap.samples.deliveries).toBe(0);
    expect(snap.lintEscapeRate).toBeNull();
  });

  it("persists snapshot next to product events", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-p-"));
    dirs.push(ws);
    const snap = persistNorthStarSnapshot(ws);
    expect(snap.schemaVersion).toBe(2);
    expect(snap.reviewDurationMsMedian).toBeNull();
    expect(snap.lintEscapeRate).toBeNull();
    expect(fs.existsSync(northStarPath(ws))).toBe(true);
  });

  it("migrates v1 snapshots by recomputing under v2 口径", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ns-mig-"));
    dirs.push(ws);
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok" });
    appendProductMetric(ws, { kind: "rewrite", outcome: "modified" });
    appendProductMetric(ws, { kind: "lint_escape", outcome: "lawyer_edit" });
    // 写入一份 v1 口径旧快照（rate=100% 时代的产物）
    fs.mkdirSync(path.dirname(northStarPath(ws)), { recursive: true });
    fs.writeFileSync(
      northStarPath(ws),
      JSON.stringify({
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        unattendedCompleteRate: null,
        firstPassRate: 1,
        reviewDurationMsMedian: null,
        lintEscapeRate: 1,
        samples: {
          firstPassOk: 1,
          firstPassFail: 0,
          unattended: 0,
          attended: 0,
          lintEscapes: 1,
          deliveries: 1,
        },
      }),
      "utf8",
    );
    const snap = readNorthStarSnapshot(ws);
    expect(snap.schemaVersion).toBe(2);
    // 按 v2 口径重算：deliveries=2、escape=1 → 0.5，且落盘已迁移
    expect(snap.lintEscapeRate).toBe(0.5);
    const onDisk = JSON.parse(fs.readFileSync(northStarPath(ws), "utf8")) as {
      schemaVersion: number;
    };
    expect(onDisk.schemaVersion).toBe(2);
  });
});
