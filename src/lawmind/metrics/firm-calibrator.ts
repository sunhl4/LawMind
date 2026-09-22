/**
 * firm-specific 校准器（P3）——机制先行，冷启动诚实拒绝。
 *
 * ## 目标函数是行为学的，不是法学的
 *
 * 本模块**不预测「法律上对不对」**（那不可测），只预测
 * **「这位律师会不会动手改」**。理由：
 *   - 它是唯一有干净标签的问题（`approvals.jsonl` 的通过/驳回、`firstPassApproved`、
 *     `ReviewLabel` 的 14 类）；
 *   - 它恰好**就是拍板门禁需要判的东西**——门禁要决定的正是「这次该不该打断律师」；
 *   - 它可测、可校准，不依赖任何法学真值。
 *
 * **不要把它当质量模型。** 它学得到「本所习惯改哪类稿」，学不到「稿子对不对」。
 *
 * ## 与「买一个概率模型」的区别
 *
 * 本模块产出的是**你自己的参数**：特征权重 + 校准系数拟合自**本所历史**，
 * 零出网、零供应商、零边际成本。而且越用越准——标签随使用增长，而厂商模型
 * 只随厂商升级。
 *
 * ## 冷启动必须诚实
 *
 * 样本不足时**不得产出一个看起来能用的校准器**。`fitFirmCalibrator` 在样本量或
 * 类别平衡不达标时返回 `status: "insufficient"` 并给出具体原因。参照
 * `metrics/north-star.ts` 的「Missing samples stay null — do not invent a 0% story」：
 * 在 2 个样本上「拟合成功」比拟合失败更危险。
 *
 * ## 已知偏置（必须随产物一起呈现）
 *
 * 标签只来自**走到拍板/审核那条路**的动作。被静默放行的动作不产生标签
 * （见 `agent/dangerous-tool-policy.ts`：运行期只拦 `send_email`）。因此：
 *   - 训练集会**系统性缺少「律师没看就过了」的样本**；
 *   - 由此拟合出的模型在「明显无需干预」的稿子上会**偏高估风险**（把它判成需要改动）。
 * 这是保守方向的偏置，可以接受，但**必须写出来**，否则会被误读成质量评分。
 */

import { listQualityRecords } from "../evaluation/quality.js";
import type { DecisionSampleSignal } from "./decision-samples.js";
import { collectDecisionSamples } from "./decision-samples.js";
import { readProductMetricEvents } from "./product-metrics.js";

/** 样本量与类别平衡门槛。达不到就拒绝拟合。 */
export const COLD_START_MIN_SAMPLES = 40;
export const COLD_START_MIN_PER_CLASS = 5;

/** 训练特征名（顺序即向量顺序，改动必须同步 `FEATURE_VERSION`）。 */
export const FEATURE_NAMES = [
  "citationValidityRate",
  "issueCoverageRate",
  "riskRecallRate",
  "reviewLabelCount",
  "ruleHitCount",
  "snippetCharCount",
  "latencyLog",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * 特征口径版本。**特征是模型的一部分**——改了特征定义，旧拟合结果就不再有意义。
 * 与 `lint/statute-params.ts` 的 `effectiveFrom` 是同一思路：产物要能自证来历。
 */
export const FEATURE_VERSION = 1;

/** `null` 表示该特征缺失（不编造 0）。拟合时用**训练集均值**填充。 */
export type CalibrationFeatureVector = Record<FeatureName, number | null>;

export type CalibrationLabel = "edited" | "clean";

export type CalibrationRow = {
  taskId: string;
  matterId?: string;
  deliverableType?: string;
  features: CalibrationFeatureVector;
  /**
   * `edited` = 律师实质改过（`first_pass_fail` / `lawyer_edit` / 审核驳回）；
   * `clean`  = 一次通过且无实质修改。
   */
  label: CalibrationLabel;
  /** 标签来源信号（便于复盘「这个标签凭什么」）。 */
  labelSignals: DecisionSampleSignal[];
};

export type CalibrationDataset = {
  rows: CalibrationRow[];
  /** 诊断：各来源是否存在。 */
  sources: { quality: number; productEvents: number; decisionSamples: number };
  warnings: string[];
};

function emptyFeatures(): CalibrationFeatureVector {
  return Object.fromEntries(FEATURE_NAMES.map((n) => [n, null])) as CalibrationFeatureVector;
}

/**
 * 构建校准数据集：把质量快照（特征）+ 产品指标/决策样本（标签）按 taskId 连接。
 *
 * 只有**既有特征又有标签**的任务才进数据集——缺一边就丢弃，不插补标签。
 */
export async function buildCalibrationDataset(workspaceDir: string): Promise<CalibrationDataset> {
  const warnings: string[] = [];
  const quality = await listQualityRecords(workspaceDir).catch(() => []);
  const decision = await collectDecisionSamples(workspaceDir).catch(() => undefined);
  const product = readProductMetricEvents(workspaceDir);

  if (quality.length === 0) {
    warnings.push("没有质量快照（workspace/quality/）——特征全部缺失，无法构建数据集。");
  }

  // 标签：per task 的 edited / clean 证据
  const editedTasks = new Set<string>();
  const cleanTasks = new Set<string>();
  const signalsByTask = new Map<string, Set<DecisionSampleSignal>>();

  for (const s of decision?.samples ?? []) {
    if (!s.taskId) {
      continue;
    }
    if (!signalsByTask.has(s.taskId)) {
      signalsByTask.set(s.taskId, new Set());
    }
    signalsByTask.get(s.taskId)!.add(s.signal);
    if (s.signal === "first_pass_fail" || s.signal === "lawyer_edit") {
      editedTasks.add(s.taskId);
    }
    if (s.signal === "first_pass_ok") {
      cleanTasks.add(s.taskId);
    }
  }
  for (const ev of product.events) {
    if (!ev.taskId) {
      continue;
    }
    if (ev.kind === "rewrite") {
      editedTasks.add(ev.taskId);
    }
    if (ev.kind === "first_pass" && ev.outcome === "ok") {
      cleanTasks.add(ev.taskId);
    }
  }

  // 质量快照同时提供特征与一条更直接的标签证据
  const rows: CalibrationRow[] = [];
  for (const rec of quality) {
    const signals = [...(signalsByTask.get(rec.taskId) ?? new Set<DecisionSampleSignal>())];
    const isEdited =
      editedTasks.has(rec.taskId) ||
      rec.reviewStatus === "rejected" ||
      rec.reviewStatus === "modified";
    const isClean =
      rec.firstPassApproved || cleanTasks.has(rec.taskId) || rec.reviewStatus === "approved";

    // 两个方向都有证据时，**以 edited 为准**（保守：宁可判需要干预）。
    let label: CalibrationLabel | undefined;
    if (isEdited) {
      label = "edited";
    } else if (isClean) {
      label = "clean";
    }
    if (!label) {
      continue; // 无标签 — 不插补
    }

    const features = emptyFeatures();
    features.citationValidityRate = rec.citationValidityRate;
    features.issueCoverageRate = rec.issueCoverageRate;
    features.riskRecallRate = rec.riskRecallRate;
    features.reviewLabelCount = rec.reviewLabels.length;
    features.ruleHitCount = rec.reviewLabels.filter((l) => l.startsWith("引用")).length;
    features.snippetCharCount = null;
    features.latencyLog =
      typeof rec.latencyMs === "number" && rec.latencyMs > 0 ? Math.log(rec.latencyMs) : null;

    rows.push({
      taskId: rec.taskId,
      ...(rec.matterId ? { matterId: rec.matterId } : {}),
      label,
      labelSignals: signals,
      features,
    });
  }

  if (rows.length === 0 && quality.length > 0) {
    warnings.push(
      "有质量快照但没有任何任务同时具备特征与标签——数据集为空。不要据此认为「无需校准」。",
    );
  }

  return {
    rows,
    sources: {
      quality: quality.length,
      productEvents: product.events.length,
      decisionSamples: decision?.samples.length ?? 0,
    },
    warnings,
  };
}

// ─────────────────────────────────────────────
// 拟合（Platt 式 logistic，确定性）
// ─────────────────────────────────────────────

export type CalibrationFit = {
  status: "fitted" | "insufficient";
  /** `insufficient` 时说明缺什么；`fitted` 时说明用什么数据拟合的。 */
  reason: string;
  featureVersion: number;
  featureNames: readonly FeatureName[];
  samples: number;
  positives: number;
  negatives: number;
  /** 训练集标准化参数（拟合产物的一部分，predict 时必需）。 */
  means?: Record<FeatureName, number>;
  stdDevs?: Record<FeatureName, number>;
  /** logistic 权重（与 featureNames 同序）+ 截距。 */
  weights?: number[];
  intercept?: number;
  /** 训练集上的表现。**不是**泛化估计——样本量达标前不要外推。 */
  trainMetrics?: {
    accuracy: number;
    brier: number;
    /** 正类（edited）召回——门禁场景更关心「别漏掉该看的」。 */
    recallEdited: number;
  };
  warnings: string[];
};

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mu: number): number {
  if (values.length <= 1) {
    return 0;
  }
  const variance = values.reduce((acc, v) => acc + (v - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function sigmoid(z: number): number {
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * 拟合 firm-specific 校准器。
 *
 * **确定性**：固定迭代次数与初始值，无随机。同一份数据两次拟合得到同一组参数
 * ——这是法律软件里的硬要求（参数要能写进审计并可复现）。
 *
 * 算法：对标准化特征做 L2 正则 logistic 回归（梯度下降）。样本不足时**不拟合**。
 */
export function fitFirmCalibrator(rows: readonly CalibrationRow[]): CalibrationFit {
  const warnings: string[] = [];
  const positives = rows.filter((r) => r.label === "edited").length;
  const negatives = rows.filter((r) => r.label === "clean").length;

  const base: Pick<
    CalibrationFit,
    "featureVersion" | "featureNames" | "samples" | "positives" | "negatives"
  > = {
    featureVersion: FEATURE_VERSION,
    featureNames: FEATURE_NAMES,
    samples: rows.length,
    positives,
    negatives,
  };

  if (rows.length < COLD_START_MIN_SAMPLES) {
    return {
      ...base,
      status: "insufficient",
      reason:
        `样本量不足：${rows.length} < ${COLD_START_MIN_SAMPLES}。` +
        "在这么少的样本上拟合出的权重不可复现、不可外推——不产出校准器。",
      warnings,
    };
  }
  if (positives < COLD_START_MIN_PER_CLASS || negatives < COLD_START_MIN_PER_CLASS) {
    return {
      ...base,
      status: "insufficient",
      reason:
        `类别不平衡：edited=${positives} / clean=${negatives}，每类需 ≥ ${COLD_START_MIN_PER_CLASS}。` +
        "单类样本会让模型退化成「全判同一类」。",
      warnings,
    };
  }

  // 用训练集均值填充缺失特征（并记录均值/标准差，predict 时必须复用）。
  const means = {} as Record<FeatureName, number>;
  const stdDevs = {} as Record<FeatureName, number>;
  for (const name of FEATURE_NAMES) {
    const present = rows
      .map((r) => r.features[name])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const mu = present.length > 0 ? mean(present) : 0;
    means[name] = mu;
    const sd = present.length > 1 ? stdDev(present, mu) : 0;
    // 零方差特征不做标准化（否则除零）——记为 1，等价于不缩放。
    stdDevs[name] = sd > 1e-9 ? sd : 1;
  }

  const xs: number[][] = rows.map((r) =>
    FEATURE_NAMES.map((name) => {
      const raw = r.features[name];
      const v = typeof raw === "number" && Number.isFinite(raw) ? raw : means[name];
      return (v - means[name]) / stdDevs[name];
    }),
  );
  const ys: number[] = rows.map((r) => (r.label === "edited" ? 1 : 0));

  // 梯度下降（确定性：固定初始值 0、固定步数）。
  const dims = FEATURE_NAMES.length;
  let weights = Array.from({ length: dims }, () => 0);
  let intercept = 0;
  const lr = 0.35;
  const l2 = 0.01;
  const iterations = 600;
  const n = xs.length;

  for (let step = 0; step < iterations; step += 1) {
    const gradW = Array.from({ length: dims }, () => 0);
    let gradB = 0;
    for (let i = 0; i < n; i += 1) {
      const xi = xs[i];
      let z = intercept;
      for (let d = 0; d < dims; d += 1) {
        z += weights[d] * xi[d];
      }
      const err = sigmoid(z) - ys[i];
      for (let d = 0; d < dims; d += 1) {
        gradW[d] += err * xi[d];
      }
      gradB += err;
    }
    for (let d = 0; d < dims; d += 1) {
      weights[d] -= lr * (gradW[d] / n + l2 * weights[d]);
    }
    intercept -= lr * (gradB / n);
  }

  // 训练集指标
  let correct = 0;
  let brierSum = 0;
  let editedHit = 0;
  for (let i = 0; i < n; i += 1) {
    const xi = xs[i];
    let z = intercept;
    for (let d = 0; d < dims; d += 1) {
      z += weights[d] * xi[d];
    }
    const p = sigmoid(z);
    brierSum += (p - ys[i]) ** 2;
    if ((p >= 0.5 ? 1 : 0) === ys[i]) {
      correct += 1;
    }
    if (ys[i] === 1 && p >= 0.5) {
      editedHit += 1;
    }
  }

  warnings.push("trainMetrics 是**训练集**表现，不是泛化估计。样本量接近门槛时它几乎必然偏乐观。");
  warnings.push(
    "标签只来自走到拍板/审核的动作；被静默放行的样本不在训练集中，模型在「明显无需干预」的稿子上会偏高估风险。",
  );

  return {
    ...base,
    status: "fitted",
    reason: `以 ${rows.length} 条样本拟合（edited=${positives} / clean=${negatives}）。`,
    means,
    stdDevs,
    weights,
    intercept,
    trainMetrics: {
      accuracy: correct / n,
      brier: brierSum / n,
      recallEdited: positives > 0 ? editedHit / positives : 0,
    },
    warnings,
  };
}

/**
 * 用拟合结果预测 P(律师会动手改)。
 *
 * 未拟合（`insufficient`）时返回 `undefined`——**不返回默认概率**。
 * 返回一个「大概 0.5」会让调用方以为有信号，而那正是最危险的失败模式。
 */
export function predictEditProbability(
  fit: CalibrationFit,
  features: CalibrationFeatureVector,
): number | undefined {
  if (
    fit.status !== "fitted" ||
    !fit.weights ||
    !fit.means ||
    !fit.stdDevs ||
    typeof fit.intercept !== "number"
  ) {
    return undefined;
  }
  let z = fit.intercept;
  FEATURE_NAMES.forEach((name, d) => {
    const raw = features[name];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : fit.means![name];
    z += fit.weights![d] * ((v - fit.means![name]) / fit.stdDevs![name]);
  });
  return sigmoid(z);
}

/** 供 Doctor / CLI 展示：拟合结果的单行摘要（含诚实口径）。 */
export function describeCalibrationFit(fit: CalibrationFit): string {
  if (fit.status === "insufficient") {
    return `校准器未产出（样本 ${fit.samples}，edited=${fit.positives}/clean=${fit.negatives}）：${fit.reason}`;
  }
  const m = fit.trainMetrics!;
  return (
    `校准器已拟合（样本 ${fit.samples}，edited=${fit.positives}/clean=${fit.negatives}）· ` +
    `训练集准确率 ${(m.accuracy * 100).toFixed(1)}% · Brier ${m.brier.toFixed(3)} · ` +
    `正类召回 ${(m.recallEdited * 100).toFixed(1)}%`
  );
}
