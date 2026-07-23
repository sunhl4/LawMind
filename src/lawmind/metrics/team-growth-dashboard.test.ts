import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit } from "../audit/index.js";
import { suggestMemoryAdoption } from "../memory/adoption-service.js";
import { appendProductMetric } from "./product-metrics.js";
import {
  buildTeamGrowthDashboard,
  captureTeamGrowthBaseline,
  loadTeamGrowthBaseline,
} from "./team-growth-dashboard.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-team-growth-"));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, "audit"), { recursive: true });
  return dir;
}

describe("team-growth-dashboard", () => {
  it("builds empty-window snapshot with null rates", async () => {
    const ws = tmpWs();
    const dash = await buildTeamGrowthDashboard(ws, { windowDays: 30 });
    expect(dash.windowDays).toBe(30);
    expect(dash.metrics).toHaveLength(5);
    expect(dash.baseline).toBeNull();
    for (const m of dash.metrics) {
      expect(m.value).toBeNull();
      expect(m.denominator).toBe(0);
    }
  });

  it("computes routing hit and peer coverage from audit", async () => {
    const ws = tmpWs();
    const auditDir = path.join(ws, "audit");
    await emit(auditDir, {
      taskId: "t1",
      kind: "routing.resolve_ok",
      actor: "system",
      detail: "{}",
    });
    await emit(auditDir, {
      taskId: "t2",
      kind: "routing.resolve_fallback",
      actor: "system",
      detail: "{}",
    });
    await emit(auditDir, {
      taskId: "t3",
      kind: "draft.peer_review_required",
      actor: "system",
      detail: "{}",
    });
    await emit(auditDir, {
      taskId: "t4",
      kind: "draft.peer_review_skipped",
      actor: "system",
      detail: "{}",
    });
    await emit(auditDir, {
      taskId: "t5",
      kind: "draft.peer_review_skipped",
      actor: "system",
      detail: "{}",
    });

    const dash = await buildTeamGrowthDashboard(ws, { windowDays: 7 });
    const routing = dash.metrics.find((m) => m.id === "routing_hit_rate");
    const peer = dash.metrics.find((m) => m.id === "peer_review_coverage");
    expect(routing?.numerator).toBe(1);
    expect(routing?.denominator).toBe(2);
    expect(routing?.value).toBeCloseTo(0.5);
    expect(peer?.numerator).toBe(1);
    expect(peer?.denominator).toBe(3);
    expect(peer?.value).toBeCloseTo(1 / 3);
  });

  it("computes learning process rate and first-pass from product metrics", async () => {
    const ws = tmpWs();
    appendProductMetric(ws, {
      kind: "first_pass",
      outcome: "ok",
      taskId: "t1",
      meta: { assistantId: "a1" },
    });
    appendProductMetric(ws, {
      kind: "rewrite",
      outcome: "modified",
      taskId: "t2",
      meta: { assistantId: "a1" },
    });
    const auditDir = path.join(ws, "audit");
    await suggestMemoryAdoption(ws, auditDir, {
      scope: "matter",
      kind: "case.progress",
      targetId: "m1",
      payload: "进度一条",
      origin: "agent",
    });
    await suggestMemoryAdoption(ws, auditDir, {
      scope: "assistant",
      kind: "assistant.profile_section",
      targetId: "a1",
      payload: "偏好",
      origin: "lawyer",
    });

    const dash = await buildTeamGrowthDashboard(ws, { windowDays: 30 });
    const fp = dash.metrics.find((m) => m.id === "first_pass_rate");
    const rw = dash.metrics.find((m) => m.id === "rewrite_rate");
    const learn = dash.metrics.find((m) => m.id === "learning_process_rate");
    expect(fp?.numerator).toBe(1);
    expect(fp?.denominator).toBe(2);
    expect(rw?.numerator).toBe(1);
    expect(learn?.numerator).toBe(0);
    expect(learn?.denominator).toBe(2);
    expect(learn?.value).toBe(0);
  });

  it("captures baseline and reports delta", async () => {
    const ws = tmpWs();
    const auditDir = path.join(ws, "audit");
    await emit(auditDir, {
      taskId: "t1",
      kind: "routing.resolve_ok",
      actor: "system",
      detail: "{}",
    });
    const { dashboard, baseline } = await captureTeamGrowthBaseline(ws, {
      windowDays: 14,
      note: "内测起点",
    });
    expect(baseline.version).toBe(1);
    expect(baseline.note).toBe("内测起点");
    expect(loadTeamGrowthBaseline(ws)?.capturedAt).toBe(baseline.capturedAt);
    expect(dashboard.baseline?.note).toBe("内测起点");

    await emit(auditDir, {
      taskId: "t2",
      kind: "routing.resolve_ok",
      actor: "system",
      detail: "{}",
    });
    await emit(auditDir, {
      taskId: "t3",
      kind: "routing.resolve_fallback",
      actor: "system",
      detail: "{}",
    });
    const next = await buildTeamGrowthDashboard(ws, { windowDays: 14 });
    const routing = next.metrics.find((m) => m.id === "routing_hit_rate");
    // baseline was 1/1=1.0; now 2/3≈0.667 → delta ≈ -33.3pt
    expect(routing?.baselineValue).toBe(1);
    expect(routing?.deltaPts).toBeCloseTo(-33.3, 0);
  });
});
