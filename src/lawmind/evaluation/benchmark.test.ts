/**
 * LawMind 评测体系单元测试
 */

import { describe, expect, it } from "vitest";
import type { BenchmarkResult, BenchmarkTask } from "../types.js";
import {
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildBenchmarkReportMarkdown,
} from "./benchmark.js";

// ─────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    benchmarkId: "bm-test-001",
    runId: "run-123",
    ranAt: new Date().toISOString(),
    taskCompleted: true,
    kindMatched: true,
    keywordHitRate: 1,
    riskLevelMatched: true,
    reviewGateMatched: true,
    sourceCount: 3,
    claimCount: 5,
    latencyMs: 1200,
    score: 1.0,
    ...overrides,
  };
}

function makeTask(overrides: Partial<BenchmarkTask> = {}): BenchmarkTask {
  return {
    benchmarkId: "bm-test-001",
    category: "contract_review",
    instruction: "审查违约金条款",
    expectedKind: "analyze.contract",
    expectedOutput: "docx",
    expectedKeywords: ["违约金"],
    expectedRiskLevel: "medium",
    expectsReviewGate: false,
    description: "测试任务",
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// BUILTIN_BENCHMARK_TASKS 基础校验
// ─────────────────────────────────────────────

describe("BUILTIN_BENCHMARK_TASKS", () => {
  it("内置任务不为空", () => {
    expect(BUILTIN_BENCHMARK_TASKS.length).toBeGreaterThan(0);
  });

  it("每个内置任务的 benchmarkId 唯一", () => {
    const ids = BUILTIN_BENCHMARK_TASKS.map((t) => t.benchmarkId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("每个内置任务至少有一个期望关键词", () => {
    for (const task of BUILTIN_BENCHMARK_TASKS) {
      expect(task.expectedKeywords.length).toBeGreaterThan(0);
    }
  });

  it("期望输出格式与任务类型一致（ppt场景用pptx）", () => {
    const pptTask = BUILTIN_BENCHMARK_TASKS.find((t) => t.category === "client_brief");
    expect(pptTask?.expectedOutput).toBe("pptx");
  });
});

// ─────────────────────────────────────────────
// benchmarkPassesThreshold
// ─────────────────────────────────────────────

describe("benchmarkPassesThreshold", () => {
  it("所有满分时通过默认阈值（0.7）", () => {
    const results = [
      makeResult({ score: 1.0 }),
      makeResult({ score: 0.9 }),
      makeResult({ score: 0.8 }),
    ];
    expect(benchmarkPassesThreshold(results)).toBe(true);
  });

  it("低均分时不通过", () => {
    const results = [makeResult({ score: 0.5 }), makeResult({ score: 0.4 })];
    expect(benchmarkPassesThreshold(results)).toBe(false);
  });

  it("空数组返回 false", () => {
    expect(benchmarkPassesThreshold([])).toBe(false);
  });

  it("可以自定义阈值", () => {
    const results = [makeResult({ score: 0.65 })];
    expect(benchmarkPassesThreshold(results, 0.6)).toBe(true);
    expect(benchmarkPassesThreshold(results, 0.7)).toBe(false);
  });

  it("恰好等于阈值时通过", () => {
    const results = [makeResult({ score: 0.7 })];
    expect(benchmarkPassesThreshold(results, 0.7)).toBe(true);
  });
});

// ─────────────────────────────────────────────
// buildBenchmarkReportMarkdown
// ─────────────────────────────────────────────

describe("buildBenchmarkReportMarkdown", () => {
  it("空结果时返回无评测结果提示", () => {
    const report = buildBenchmarkReportMarkdown([], []);
    expect(report).toContain("无评测结果");
  });

  it("报告包含汇总和明细两个章节", () => {
    const results = [makeResult()];
    const tasks = [makeTask()];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("汇总");
    expect(report).toContain("明细");
  });

  it("平均分 100% 时报告中体现", () => {
    const results = [makeResult({ score: 1.0 })];
    const tasks = [makeTask()];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("100.0%");
  });

  it("失败任务在报告中标记 Fail", () => {
    const results = [makeResult({ taskCompleted: false, score: 0 })];
    const tasks = [makeTask()];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("Fail");
  });

  it("高分任务在报告中标记 Pass", () => {
    const results = [makeResult({ score: 0.85, taskCompleted: true })];
    const tasks = [makeTask()];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("Pass");
  });

  it("低分但完成的任务标记 Low", () => {
    const results = [makeResult({ score: 0.5, taskCompleted: true })];
    const tasks = [makeTask()];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("Low");
  });

  it("报告包含任务描述", () => {
    const results = [makeResult()];
    const tasks = [makeTask({ description: "违约金条款审查基准" })];
    const report = buildBenchmarkReportMarkdown(results, tasks);
    expect(report).toContain("违约金条款审查基准");
  });
});
