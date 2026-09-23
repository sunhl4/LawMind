import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summarizeContextPressure } from "./context-pressure.js";
import { appendProductMetric } from "./product-metrics.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-ctxpressure-"));
  tempDirs.push(dir);
  return dir;
}

function pressure(
  ws: string,
  outcome: string,
  opts?: { turnId?: string; meta?: Record<string, unknown> },
): void {
  appendProductMetric(ws, {
    kind: "context_pressure",
    outcome,
    ...(opts?.turnId ? { taskId: opts.turnId } : {}),
    ...(opts?.meta ? { meta: opts.meta as Record<string, string | number | boolean | null> } : {}),
  });
}

describe("summarizeContextPressure", () => {
  it("缺来源 → present:false，绝不产出 0（0% 与「没数据」必须长得不一样）", () => {
    const ws = workspace();
    const summary = summarizeContextPressure(ws);
    expect(summary.present).toBe(false);
    expect(summary.events).toBe(0);
    // 比率必须 null，不是 0。
    expect(summary.deferralReachRate).toBeNull();
    expect(summary.compactionEffectiveness).toBeNull();
  });

  it("有事件但没有退让 → present:true 且比率为 null（分母为 0 不给 0）", () => {
    const ws = workspace();
    pressure(ws, "mid_turn_compact", { turnId: "t1" });
    pressure(ws, "mid_turn_compact", { turnId: "t2", meta: { roundIndex: 2 } });
    const summary = summarizeContextPressure(ws);
    expect(summary.present).toBe(true);
    expect(summary.events).toBe(2);
    expect(summary.turnsWithPressure).toBe(2);
    expect(summary.compactions.midTurn).toBe(2);
    expect(summary.deferrals.detected).toBe(0);
    // 「一次都没退让」不等于「0% 的退让到达律师」——后者无意义，给 null。
    expect(summary.deferralReachRate).toBeNull();
  });

  it("退让到达律师的比例：分子分母同源", () => {
    const ws = workspace();
    pressure(ws, "deferral_detected", { turnId: "t1" });
    pressure(ws, "deferral_bounced", { turnId: "t1" });
    pressure(ws, "deferral_detected", { turnId: "t2" });
    pressure(ws, "deferral_bounced", { turnId: "t2" });
    pressure(ws, "deferral_detected", { turnId: "t3" });
    pressure(ws, "deferral_reached_lawyer", { turnId: "t3" });

    const summary = summarizeContextPressure(ws);
    expect(summary.deferrals).toEqual({ detected: 3, bounced: 2, reachedLawyer: 1 });
    expect(summary.deferralReachRate).toBeCloseTo(1 / 3, 6);
    // 三次退让都在三个不同回合里。
    expect(summary.turnsWithPressure).toBe(3);
  });

  it("整理有效性：只有「尝试整理」进分母（prune_only / cap 不算尝试）", () => {
    const ws = workspace();
    pressure(ws, "mid_turn_compact", { turnId: "t1" });
    pressure(ws, "mid_turn_compact", { turnId: "t2" });
    pressure(ws, "mid_turn_compact", { turnId: "t3" });
    pressure(ws, "mid_turn_no_reduction", { turnId: "t4" });
    pressure(ws, "mid_turn_prune_only", { turnId: "t5" });
    pressure(ws, "mid_turn_cap", { turnId: "t6" });

    const summary = summarizeContextPressure(ws);
    expect(summary.compactions).toMatchObject({
      midTurn: 3,
      pruneOnly: 1,
      noReduction: 1,
      cap: 1,
    });
    // 3 成功 / (3 成功 + 1 压了不减) = 0.75
    expect(summary.compactionEffectiveness).toBeCloseTo(0.75, 6);
  });

  it("模型摘要：区分「真用了」与「回落」，延迟给 P95（不问平均）", () => {
    const ws = workspace();
    const withLatency = (outcome: string, meta: Record<string, unknown>): void =>
      pressure(ws, outcome, { turnId: `t-${Math.random()}`, meta });
    withLatency("mid_turn_llm_digest", { usedLlm: true, latencyMs: 1_200 });
    withLatency("mid_turn_llm_digest", { usedLlm: true, latencyMs: 2_000 });
    withLatency("mid_turn_llm_digest", { usedLlm: false, latencyMs: 15_000 });

    const summary = summarizeContextPressure(ws);
    expect(summary.compactions.llmDigest.attempted).toBe(3);
    // 「真用了模型输出」与「回落提取式」必须分开看：只看 attempted 会误判质量。
    expect(summary.compactions.llmDigest.used).toBe(2);
    expect(summary.compactions.llmDigest.fellBack).toBe(1);
    // P95 落在最慢那档（15s 超时是真实存在的上限）。
    expect(summary.compactions.llmDigest.latencyP95Ms).toBe(15_000);
  });

  it("没有模型摘要事件时 latencyP95 为 null（不产 0）", () => {
    const ws = workspace();
    pressure(ws, "mid_turn_compact", { turnId: "t1" });
    const summary = summarizeContextPressure(ws);
    expect(summary.compactions.llmDigest).toEqual({
      attempted: 0,
      used: 0,
      fellBack: 0,
      latencyP95Ms: null,
    });
  });

  it("分叉拒绝按原因归类（运维要能看出卡在哪一环）", () => {
    const ws = workspace();
    pressure(ws, "fork_created", { turnId: "t1" });
    pressure(ws, "fork_blocked", { turnId: "t2", meta: { code: "pending_authorization" } });
    pressure(ws, "fork_blocked", { turnId: "t3", meta: { code: "turn_live" } });
    pressure(ws, "fork_blocked", { turnId: "t4", meta: { code: "pending_authorization" } });

    const summary = summarizeContextPressure(ws);
    expect(summary.forks.created).toBe(1);
    expect(summary.forks.blocked).toBe(3);
    expect(summary.forks.blockedByCode).toEqual({ pending_authorization: 2, turn_live: 1 });
  });

  it("其它 kind 的事件不混进本口径", () => {
    const ws = workspace();
    appendProductMetric(ws, { kind: "first_pass", outcome: "ok", taskId: "t1" });
    appendProductMetric(ws, { kind: "material_block", outcome: "complete", taskId: "t2" });
    pressure(ws, "mid_turn_compact", { turnId: "t3" });

    const summary = summarizeContextPressure(ws);
    expect(summary.events).toBe(1);
    expect(summary.turnsWithPressure).toBe(1);
  });

  it("窗口截断时显式标注，并把 totalLines 一并给出", () => {
    const ws = workspace();
    for (let i = 0; i < 12; i += 1) {
      pressure(ws, "mid_turn_compact", { turnId: `t${i}` });
    }
    // limit 小于总行数 → 只统计窗口内，且必须自报被截断。
    const summary = summarizeContextPressure(ws, 5);
    expect(summary.truncated).toBe(true);
    expect(summary.totalLines).toBe(12);
    expect(summary.events).toBe(5);
    expect(summary.windowFrom).toBeTruthy();
    expect(summary.windowTo).toBeTruthy();
  });

  it("turnId 缺失时不计入回合数（不拿空字符串凑分母）", () => {
    const ws = workspace();
    pressure(ws, "mid_turn_compact");
    pressure(ws, "mid_turn_compact", { turnId: "" });
    pressure(ws, "mid_turn_compact", { turnId: "t1" });
    const summary = summarizeContextPressure(ws);
    expect(summary.events).toBe(3);
    expect(summary.turnsWithPressure).toBe(1);
  });
});
