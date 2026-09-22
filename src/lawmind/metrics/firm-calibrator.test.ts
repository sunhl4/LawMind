import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { QualityRecord } from "../types.js";
import {
  COLD_START_MIN_PER_CLASS,
  COLD_START_MIN_SAMPLES,
  FEATURE_NAMES,
  FEATURE_VERSION,
  buildCalibrationDataset,
  describeCalibrationFit,
  fitFirmCalibrator,
  predictEditProbability,
  type CalibrationFeatureVector,
  type CalibrationRow,
} from "./firm-calibrator.js";

const dirs: string[] = [];

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-cal-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

/** 造一条构造样本（避开真实 quality 持久化格式，专注拟合逻辑）。 */
function row(
  label: "edited" | "clean",
  overrides: Partial<CalibrationFeatureVector> = {},
): CalibrationRow {
  const features = Object.fromEntries(
    FEATURE_NAMES.map((n) => [n, null]),
  ) as CalibrationFeatureVector;
  return {
    taskId: `t-${Math.random().toString(36).slice(2, 10)}`,
    label,
    labelSignals: [],
    features: { ...features, ...overrides },
  };
}

/** 生成可分数据：edited 的 citationValidityRate 低、reviewLabelCount 高。 */
function separableRows(n: number): CalibrationRow[] {
  const out: CalibrationRow[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(
      row("edited", {
        citationValidityRate: 0.2 + (i % 3) * 0.05,
        reviewLabelCount: 3 + (i % 2),
        riskRecallRate: 0.3,
        latencyLog: 9,
        issueCoverageRate: 0.4,
        ruleHitCount: 2,
        snippetCharCount: 200,
      }),
    );
    out.push(
      row("clean", {
        citationValidityRate: 0.95 - (i % 3) * 0.02,
        reviewLabelCount: 0,
        riskRecallRate: 0.9,
        latencyLog: 8,
        issueCoverageRate: 0.95,
        ruleHitCount: 0,
        snippetCharCount: 300,
      }),
    );
  }
  return out;
}

describe("P3 冷启动必须诚实拒绝（不得产出看起来能用的校准器）", () => {
  it("样本量为 0 → insufficient，且 reason 说清缺什么", () => {
    const fit = fitFirmCalibrator([]);
    expect(fit.status).toBe("insufficient");
    expect(fit.reason).toContain("样本量不足");
    expect(fit.weights).toBeUndefined();
    expect(fit.trainMetrics).toBeUndefined();
  });

  it("2 条样本（本仓当前真实情况）→ insufficient，绝不拟合", () => {
    const fit = fitFirmCalibrator([row("edited"), row("clean")]);
    expect(fit.status).toBe("insufficient");
    expect(fit.samples).toBe(2);
    expect(fit.weights).toBeUndefined();
    expect(fit.reason).toContain(String(COLD_START_MIN_SAMPLES));
  });

  it("样本量达标但单类不足 → insufficient（防退化成全判同一类）", () => {
    // 44 条：edited=42 / clean=2 —— 样本量过门槛，但 clean 远少于每类下限
    const rows = [
      ...separableRows(21).map((r) => ({ ...r, label: "edited" as const })),
      ...separableRows(1),
    ];
    const fit = fitFirmCalibrator(rows);
    expect(fit.samples).toBeGreaterThanOrEqual(COLD_START_MIN_SAMPLES);
    expect(fit.negatives).toBeLessThan(COLD_START_MIN_PER_CLASS);
    expect(fit.status).toBe("insufficient");
    expect(fit.reason).toContain("类别不平衡");
    expect(fit.weights).toBeUndefined();
  });

  it("全为同一类（连样本量都不够时也拒绝）—— 单类等于没有判别信息", () => {
    const rows = separableRows(COLD_START_MIN_SAMPLES).map((r) => ({
      ...r,
      label: "edited" as const,
    }));
    const fit = fitFirmCalibrator(rows);
    expect(fit.status).toBe("insufficient");
    expect(fit.negatives).toBe(0);
  });

  it("未拟合时 predict 返回 undefined —— 不返回「大概 0.5」", () => {
    const fit = fitFirmCalibrator([row("edited")]);
    const p = predictEditProbability(fit, row("edited").features);
    expect(p).toBeUndefined();
  });

  it("describeCalibrationFit 对未拟合如实表述", () => {
    const s = describeCalibrationFit(fitFirmCalibrator([row("edited")]));
    expect(s).toContain("未产出");
    expect(s).toContain("样本");
  });
});

describe("P3 拟合（样本充足时）", () => {
  it("达标样本 → fitted，产出可复现的权重与口径元数据", () => {
    const rows = separableRows(30); // 60 条，每类 30
    const fit = fitFirmCalibrator(rows);
    expect(fit.status).toBe("fitted");
    expect(fit.featureVersion).toBe(FEATURE_VERSION);
    expect(fit.featureNames).toEqual([...FEATURE_NAMES]);
    expect(fit.weights).toHaveLength(FEATURE_NAMES.length);
    expect(typeof fit.intercept).toBe("number");
    expect(fit.means).toBeDefined();
    expect(fit.stdDevs).toBeDefined();
  });

  it("**确定性**：同一份数据两次拟合得到完全相同的参数（可写进审计并可复现）", () => {
    const rows = separableRows(30);
    const a = fitFirmCalibrator(rows);
    const b = fitFirmCalibrator(rows);
    expect(a.weights).toEqual(b.weights);
    expect(a.intercept).toBe(b.intercept);
    expect(a.means).toEqual(b.means);
    expect(a.stdDevs).toEqual(b.stdDevs);
  });

  it("可分数据上训练集准确率高，且正类召回不为 0", () => {
    const fit = fitFirmCalibrator(separableRows(30));
    expect(fit.trainMetrics!.accuracy).toBeGreaterThan(0.9);
    expect(fit.trainMetrics!.recallEdited).toBeGreaterThan(0.8);
    expect(fit.trainMetrics!.brier).toBeLessThan(0.2);
  });

  it("predict 在可分数据上把 edited 判得比 clean 高", () => {
    const fit = fitFirmCalibrator(separableRows(30));
    const edited = row("edited", {
      citationValidityRate: 0.2,
      reviewLabelCount: 3,
      riskRecallRate: 0.3,
      latencyLog: 9,
      issueCoverageRate: 0.4,
      ruleHitCount: 2,
      snippetCharCount: 200,
    });
    const clean = row("clean", {
      citationValidityRate: 0.95,
      reviewLabelCount: 0,
      riskRecallRate: 0.9,
      latencyLog: 8,
      issueCoverageRate: 0.95,
      ruleHitCount: 0,
      snippetCharCount: 300,
    });
    const pEdited = predictEditProbability(fit, edited.features)!;
    const pClean = predictEditProbability(fit, clean.features)!;
    expect(pEdited).toBeGreaterThan(pClean);
    expect(pEdited).toBeGreaterThan(0.5);
    expect(pClean).toBeLessThan(0.5);
  });

  it("缺失特征用训练集均值填充，不抛", () => {
    const fit = fitFirmCalibrator(separableRows(30));
    const p = predictEditProbability(fit, row("edited").features);
    expect(typeof p).toBe("number");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("零方差特征不导致除零（stdDev 记为 1）", () => {
    // 所有行同一特征值 → 方差 0
    const rows = separableRows(30).map((r) => ({
      ...r,
      features: { ...r.features, latencyLog: 8 },
    }));
    const fit = fitFirmCalibrator(rows);
    expect(fit.status).toBe("fitted");
    expect(fit.stdDevs!.latencyLog).toBe(1);
    expect(Number.isFinite(predictEditProbability(fit, rows[0].features)!)).toBe(true);
  });

  it("拟合产物必须带偏置声明与「训练集≠泛化」的声明", () => {
    const fit = fitFirmCalibrator(separableRows(30));
    const blob = fit.warnings.join("\n");
    expect(blob).toContain("训练集");
    expect(blob).toContain("泛化");
    expect(blob).toContain("静默放行");
  });

  it("describeCalibrationFit 对已拟合给出训练集口径（不外推）", () => {
    const fit = fitFirmCalibrator(separableRows(30));
    const s = describeCalibrationFit(fit);
    expect(s).toContain("已拟合");
    expect(s).toContain("训练集准确率");
  });
});

describe("P3 数据集构建（连接质量快照与标签）", () => {
  function writeQuality(ws: string, records: QualityRecord[]): void {
    // 真实格式：每任务一个 `<taskId>.quality.json`（见 evaluation/quality.ts 的 qualityFilePath）
    const dir = path.join(ws, "quality");
    fs.mkdirSync(dir, { recursive: true });
    for (const r of records) {
      fs.writeFileSync(
        path.join(dir, `${r.taskId}.quality.json`),
        JSON.stringify(r, null, 2),
        "utf8",
      );
    }
  }

  function rec(over: Partial<QualityRecord> & { taskId: string }): QualityRecord {
    return {
      taskId: over.taskId,
      taskKind: "draft.word",
      citationValidityRate: 0.9,
      issueCoverageRate: 0.9,
      riskRecallRate: 0.9,
      firstPassApproved: true,
      reviewStatus: "approved",
      reviewLabels: [],
      isGoldenExample: false,
      createdAt: new Date().toISOString(),
      ...over,
    };
  }

  it("空工作区 → 数据集为空 + 诚实 warning，不编造行", async () => {
    const ws = makeWorkspace();
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows).toEqual([]);
    expect(ds.warnings.join("\n")).toContain("没有质量快照");
  });

  it("firstPassApproved=true → clean 标签", async () => {
    const ws = makeWorkspace();
    writeQuality(ws, [rec({ taskId: "t1", firstPassApproved: true, reviewStatus: "approved" })]);
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows).toHaveLength(1);
    expect(ds.rows[0]?.label).toBe("clean");
  });

  it("reviewStatus=rejected → edited 标签", async () => {
    const ws = makeWorkspace();
    writeQuality(ws, [rec({ taskId: "t1", firstPassApproved: false, reviewStatus: "rejected" })]);
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows[0]?.label).toBe("edited");
  });

  it("两向证据冲突时以 edited 为准（保守：宁可判需要干预）", async () => {
    const ws = makeWorkspace();
    // firstPassApproved=true（clean 方向）但同时 reviewStatus=modified（edited 方向）
    writeQuality(ws, [rec({ taskId: "t1", firstPassApproved: true, reviewStatus: "modified" })]);
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows[0]?.label).toBe("edited");
  });

  it("无任何标签证据的行被丢弃，不插补", async () => {
    const ws = makeWorkspace();
    writeQuality(ws, [
      rec({ taskId: "t1", firstPassApproved: false, reviewStatus: "pending" as never }),
    ]);
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows).toEqual([]);
    expect(ds.warnings.join("\n")).toContain("数据集为空");
  });

  it("特征缺失保持 null（不编造 0）", async () => {
    const ws = makeWorkspace();
    writeQuality(ws, [
      rec({
        taskId: "t1",
        firstPassApproved: true,
        citationValidityRate: null,
        issueCoverageRate: null,
        riskRecallRate: null,
      }),
    ]);
    const ds = await buildCalibrationDataset(ws);
    const f = ds.rows[0].features;
    expect(f.citationValidityRate).toBeNull();
    expect(f.issueCoverageRate).toBeNull();
    expect(f.riskRecallRate).toBeNull();
  });

  it("reviewLabelCount 与 ruleHitCount 从 ReviewLabel 派生（引用类标签）", async () => {
    const ws = makeWorkspace();
    writeQuality(ws, [
      rec({
        taskId: "t1",
        firstPassApproved: false,
        reviewStatus: "modified",
        reviewLabels: ["引用不完整", "引用有误", "争点遗漏"],
      }),
    ]);
    const ds = await buildCalibrationDataset(ws);
    expect(ds.rows[0]?.features.reviewLabelCount).toBe(3);
    expect(ds.rows[0]?.features.ruleHitCount).toBe(2);
  });

  it("本仓真实工作区跑一遍：必须 insufficient（当前样本远低于门槛）", async () => {
    const ds = await buildCalibrationDataset(path.resolve(__dirname, "../../..", "workspace"));
    const fit = fitFirmCalibrator(ds.rows);
    // 这条断言是 P0 体检结论在 P3 上的延续：数据不够就不产出校准器。
    expect(fit.status).toBe("insufficient");
    expect(fit.weights).toBeUndefined();
  });
});
