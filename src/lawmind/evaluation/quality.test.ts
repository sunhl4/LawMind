/**
 * Quality snapshot persistence + report builders.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QualityRecord } from "../types.js";
import {
  buildQualityDashboardMarkdown,
  buildQualityReportMarkdown,
  listQualityRecords,
  persistQualityRecord,
  readQualityRecord,
} from "./quality.js";

describe("evaluation/quality", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-quality-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  function sampleRecord(overrides: Partial<QualityRecord> = {}): QualityRecord {
    return {
      taskId: "task-q-1",
      taskKind: "draft.word",
      templateId: "builtin/memo",
      matterId: "matter-q",
      citationValidityRate: 0.9,
      issueCoverageRate: 0.8,
      riskRecallRate: 0.75,
      firstPassApproved: true,
      reviewStatus: "approved",
      reviewLabels: ["质量范例"],
      isGoldenExample: true,
      latencyMs: 1200,
      presetKey: "associate",
      createdAt: "2026-07-18T10:00:00.000Z",
      ...overrides,
    };
  }

  it("persistQualityRecord / readQualityRecord round-trip", async () => {
    persistQualityRecord(workspaceDir, sampleRecord());
    await new Promise((r) => setTimeout(r, 30));
    const loaded = await readQualityRecord(workspaceDir, "task-q-1");
    expect(loaded?.taskId).toBe("task-q-1");
    expect(loaded?.firstPassApproved).toBe(true);
    expect(loaded?.isGoldenExample).toBe(true);
  });

  it("readQualityRecord returns undefined for missing task", async () => {
    expect(await readQualityRecord(workspaceDir, "missing")).toBeUndefined();
  });

  it("listQualityRecords skips corrupt files", async () => {
    const dir = path.join(workspaceDir, "quality");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "good.quality.json"), JSON.stringify(sampleRecord()), "utf8");
    await fs.writeFile(path.join(dir, "bad.quality.json"), "{not-json", "utf8");
    await fs.writeFile(path.join(dir, "ignore.txt"), "x", "utf8");
    const rows = await listQualityRecords(workspaceDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe("task-q-1");
  });

  it("listQualityRecords returns empty when quality dir missing", async () => {
    expect(await listQualityRecords(workspaceDir)).toEqual([]);
  });

  it("buildQualityReportMarkdown empty workspace", async () => {
    const md = await buildQualityReportMarkdown(workspaceDir);
    expect(md).toContain("暂无质量记录");
  });

  it("buildQualityReportMarkdown aggregates labels and golden list", async () => {
    persistQualityRecord(workspaceDir, sampleRecord());
    persistQualityRecord(
      workspaceDir,
      sampleRecord({
        taskId: "task-q-2",
        firstPassApproved: false,
        reviewStatus: "modified",
        isGoldenExample: false,
        reviewLabels: ["需补充依据"],
      }),
    );
    await new Promise((r) => setTimeout(r, 40));
    const md = await buildQualityReportMarkdown(workspaceDir);
    expect(md).toContain("任务总数 | 2");
    expect(md).toContain("质量范例");
    expect(md).toContain("需补充依据");
    expect(md).toContain("黄金样本列表");
    expect(md).toContain("task-q-1");
  });

  it("buildQualityDashboardMarkdown groups by kind/template/preset", async () => {
    persistQualityRecord(workspaceDir, sampleRecord());
    persistQualityRecord(
      workspaceDir,
      sampleRecord({
        taskId: "task-q-3",
        taskKind: "research.legal",
        templateId: undefined,
        presetKey: undefined,
        firstPassApproved: false,
        isGoldenExample: false,
        reviewLabels: [],
        citationValidityRate: null,
        issueCoverageRate: 0.5,
        riskRecallRate: null,
      }),
    );
    await new Promise((r) => setTimeout(r, 40));
    const md = await buildQualityDashboardMarkdown(workspaceDir);
    expect(md).toContain("按任务类型");
    expect(md).toContain("draft.word");
    expect(md).toContain("research.legal");
    expect(md).toContain("按模板 ID");
    expect(md).toContain("(无模板)");
    expect(md).toContain("按岗位 preset");
    expect(md).toContain("(无岗位预设)");
  });

  it("buildQualityDashboardMarkdown empty", async () => {
    const md = await buildQualityDashboardMarkdown(workspaceDir);
    expect(md).toContain("暂无质量快照");
  });
});
