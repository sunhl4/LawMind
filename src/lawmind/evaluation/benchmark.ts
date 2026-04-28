import { randomUUID } from "node:crypto";
/**
 * LawMind 评测体系 — Benchmark 运行与评分
 *
 * 设计目标：
 *   - 为每个标准任务场景定义"黄金指令 + 期望特征"
 *   - 运行引擎后与期望对比，得出可回归的质量分数
 *   - 支持发布门控（score < threshold → 阻断发布）
 *
 * 使用方式：
 *   1. 在 src/lawmind/evaluation/benchmarks/ 下定义 BenchmarkTask 配置
 *   2. 调用 runBenchmark() 传入引擎实例，获取 BenchmarkResult
 *   3. 调用 buildBenchmarkReportMarkdown() 生成人可读报告
 */
import type {
  ArtifactDraft,
  BenchmarkResult,
  BenchmarkTask,
  ResearchBundle,
  TaskIntent,
} from "../types.js";

/** 运行 benchmark 所需的最小引擎接口（避免与 `index.ts` 循环依赖）。 */
export type LawMindEngineForBenchmark = {
  plan: (instruction: string, opts?: unknown) => TaskIntent;
  research: (intent: TaskIntent) => Promise<ResearchBundle>;
  draft: (intent: TaskIntent, bundle: ResearchBundle) => ArtifactDraft;
};

// ─────────────────────────────────────────────
// 内置基准任务
// ─────────────────────────────────────────────

/** 官方内置基准任务包（按场景分类）。 */
export const BUILTIN_BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    benchmarkId: "bm-contract-review-001",
    category: "contract_review",
    instruction: "请审查本合同中的违约金条款，指出风险并建议修改。",
    expectedKind: "analyze.contract",
    expectedOutput: "docx",
    expectedKeywords: ["违约金", "风险", "修改建议"],
    expectedRiskLevel: "medium",
    expectsReviewGate: false,
    description: "合同审查场景基础验收：违约金条款",
  },
  {
    benchmarkId: "bm-legal-memo-001",
    category: "legal_memo",
    instruction: "请就《民法典》担保制度修改对现有融资合同的影响出具法律意见书。",
    expectedKind: "draft.word",
    expectedOutput: "docx",
    expectedKeywords: ["担保", "融资", "影响", "法律意见"],
    expectedRiskLevel: "high",
    expectsReviewGate: true,
    description: "法律意见书场景：民法典担保制度专项",
  },
  {
    benchmarkId: "bm-demand-letter-001",
    category: "demand_letter",
    instruction: "对方未按合同约定支付货款，请起草一封律师函要求其在 7 日内付款。",
    expectedKind: "draft.word",
    expectedOutput: "docx",
    expectedKeywords: ["律师函", "付款", "违约"],
    expectedRiskLevel: "medium",
    expectsReviewGate: false,
    description: "律师函场景：逾期付款催收",
  },
  {
    benchmarkId: "bm-litigation-outline-001",
    category: "litigation_outline",
    instruction: "本案争议焦点为合同效力，请拟定诉讼策略提纲。",
    expectedKind: "draft.word",
    expectedOutput: "docx",
    expectedKeywords: ["合同效力", "诉讼策略", "争议焦点"],
    expectedRiskLevel: "high",
    expectsReviewGate: true,
    description: "诉讼策略场景：合同效力争议",
  },
  {
    benchmarkId: "bm-client-brief-001",
    category: "client_brief",
    instruction: "请将本案最新进展整理成客户可以理解的汇报 PPT。",
    expectedKind: "draft.ppt",
    expectedOutput: "pptx",
    expectedKeywords: ["案件进展", "结论"],
    expectedRiskLevel: "low",
    expectsReviewGate: false,
    description: "客户汇报 PPT 场景：案件进展摘要",
  },
];

// ─────────────────────────────────────────────
// 基准运行
// ─────────────────────────────────────────────

export type RunBenchmarkOptions = {
  /** 只运行指定 ID 的任务（不指定则运行全部） */
  taskIds?: string[];
  /** 模型标识（记录用） */
  modelHint?: string;
};

/**
 * 对引擎运行一组基准任务，返回结果列表。
 * 引擎必须已配置好检索适配器。
 */
export async function runBenchmarks(
  engine: LawMindEngineForBenchmark,
  tasks: BenchmarkTask[],
  opts: RunBenchmarkOptions = {},
): Promise<BenchmarkResult[]> {
  const toRun = opts.taskIds ? tasks.filter((t) => opts.taskIds!.includes(t.benchmarkId)) : tasks;

  const results: BenchmarkResult[] = [];
  for (const task of toRun) {
    const result = await runSingleBenchmark(engine, task, opts.modelHint);
    results.push(result);
  }
  return results;
}

async function runSingleBenchmark(
  engine: LawMindEngineForBenchmark,
  task: BenchmarkTask,
  modelHint?: string,
): Promise<BenchmarkResult> {
  const runId = `run-${randomUUID()}`;
  const ranAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const intent = engine.plan(task.instruction);
    let bundle: ResearchBundle;
    try {
      bundle = await engine.research(intent);
    } catch {
      // 检索失败但路由成功，仍记录部分结果
      bundle = {
        taskId: intent.taskId,
        query: task.instruction,
        sources: [],
        claims: [],
        riskFlags: [],
        missingItems: [],
        requiresReview: false,
        completedAt: new Date().toISOString(),
      };
    }

    const draft = engine.draft(intent, bundle);
    const latencyMs = Date.now() - startMs;

    const kindMatched = intent.kind === task.expectedKind;
    const riskLevelMatched = intent.riskLevel === task.expectedRiskLevel;
    const reviewGateMatched = intent.requiresConfirmation === task.expectsReviewGate;

    // 关键词命中：在草稿正文中检索
    const draftText = [
      draft.title,
      draft.summary,
      ...draft.sections.map((s: { heading: string; body: string }) => `${s.heading} ${s.body}`),
    ]
      .join(" ")
      .toLowerCase();

    const hitCount = task.expectedKeywords.filter((kw) =>
      draftText.includes(kw.toLowerCase()),
    ).length;
    const keywordHitRate =
      task.expectedKeywords.length > 0 ? hitCount / task.expectedKeywords.length : 1;

    const score = computeScore({
      kindMatched,
      riskLevelMatched,
      reviewGateMatched,
      keywordHitRate,
    });

    return {
      benchmarkId: task.benchmarkId,
      runId,
      ranAt,
      modelHint,
      taskCompleted: true,
      kindMatched,
      keywordHitRate,
      riskLevelMatched,
      reviewGateMatched,
      sourceCount: bundle.sources.length,
      claimCount: bundle.claims.length,
      latencyMs,
      score,
    };
  } catch (err) {
    return {
      benchmarkId: task.benchmarkId,
      runId,
      ranAt,
      modelHint,
      taskCompleted: false,
      kindMatched: false,
      keywordHitRate: 0,
      riskLevelMatched: false,
      reviewGateMatched: false,
      sourceCount: 0,
      claimCount: 0,
      latencyMs: Date.now() - startMs,
      score: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─────────────────────────────────────────────
// 评分函数
// ─────────────────────────────────────────────

const SCORE_WEIGHTS = {
  kindMatched: 0.3,
  riskLevelMatched: 0.2,
  reviewGateMatched: 0.2,
  keywordHitRate: 0.3,
} as const;

function computeScore(params: {
  kindMatched: boolean;
  riskLevelMatched: boolean;
  reviewGateMatched: boolean;
  keywordHitRate: number;
}): number {
  const score =
    (params.kindMatched ? SCORE_WEIGHTS.kindMatched : 0) +
    (params.riskLevelMatched ? SCORE_WEIGHTS.riskLevelMatched : 0) +
    (params.reviewGateMatched ? SCORE_WEIGHTS.reviewGateMatched : 0) +
    params.keywordHitRate * SCORE_WEIGHTS.keywordHitRate;
  return Math.round(score * 100) / 100;
}

// ─────────────────────────────────────────────
// 报告生成
// ─────────────────────────────────────────────

/**
 * 通过阈值检查：所有任务平均分 >= threshold。
 */
export function benchmarkPassesThreshold(results: BenchmarkResult[], threshold = 0.7): boolean {
  if (results.length === 0) {
    return false;
  }
  const avg = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  return avg >= threshold;
}

/**
 * 生成基准评测 Markdown 报告（用于 CI 输出或文档存档）。
 */
export function buildBenchmarkReportMarkdown(
  results: BenchmarkResult[],
  tasks: BenchmarkTask[],
): string {
  if (results.length === 0) {
    return "# LawMind 评测报告\n\n无评测结果。\n";
  }

  const taskMap = new Map(tasks.map((t) => [t.benchmarkId, t]));
  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
  const passCount = results.filter((r) => r.score >= 0.7).length;
  const failCount = results.length - passCount;

  const lines = [
    "# LawMind 评测报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 汇总",
    "",
    `| 指标 | 值 |`,
    `|------|----|`,
    `| 任务数 | ${results.length} |`,
    `| 平均分 | ${(avgScore * 100).toFixed(1)}% |`,
    `| 通过（≥70%）| ${passCount} |`,
    `| 失败（<70%）| ${failCount} |`,
    "",
    "## 明细",
    "",
    "| 基准 ID | 描述 | 分数 | 类型匹配 | 关键词命中率 | 风险等级匹配 | 延迟(ms) | 状态 |",
    "|---------|------|------|----------|--------------|--------------|----------|------|",
  ];

  for (const r of results) {
    const task = taskMap.get(r.benchmarkId);
    const desc = task?.description ?? r.benchmarkId;
    const scoreStr = `${(r.score * 100).toFixed(1)}%`;
    const kwStr = `${(r.keywordHitRate * 100).toFixed(0)}%`;
    const status = r.taskCompleted ? (r.score >= 0.7 ? "✅ Pass" : "⚠️ Low") : "❌ Fail";
    lines.push(
      `| ${r.benchmarkId} | ${desc} | ${scoreStr} | ${r.kindMatched ? "✓" : "✗"} | ${kwStr} | ${r.riskLevelMatched ? "✓" : "✗"} | ${r.latencyMs} | ${status} |`,
    );
  }

  return lines.join("\n");
}
