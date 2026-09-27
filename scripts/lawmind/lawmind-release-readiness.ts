import fs from "node:fs/promises";
import path from "node:path";
import {
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildQualityDashboardMarkdown,
  buildReleaseReadinessReportMarkdown,
  classifyReleaseBenchmarkFile,
  releaseReadinessBenchmarkExit,
  type BenchmarkResult,
} from "../../src/lawmind/evaluation/index.js";
import {
  formatReleaseArtifactsReport,
  inspectReleaseArtifacts,
} from "../../src/lawmind/evaluation/release-artifacts.js";
import {
  formatTrueManuscriptGateReport,
  inspectTrueManuscriptGate,
  runTrueManuscriptGateCli,
} from "../../src/lawmind/evaluation/true-manuscript-gate.js";
import {
  MIN_DELIVERIES_PER_BUCKET,
  persistNorthStarTrend,
} from "../../src/lawmind/metrics/north-star-trend.js";
import { persistNorthStarSnapshot } from "../../src/lawmind/metrics/north-star.js";

type Options = {
  workspaceDir: string;
  outputPath?: string;
  benchmarkInPath: string;
  strictBenchmark: boolean;
  benchmarkThreshold: number;
};

function parseArgs(argv: string[]): Options {
  let workspaceDir = path.resolve(process.cwd(), "workspace");
  let outputPath: string | undefined;
  let benchmarkInPath = path.resolve(process.cwd(), "dist/lawmind-benchmark.json");
  let strictBenchmark = false;
  let benchmarkThreshold = 0.8;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) {
      workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--out" && argv[i + 1]) {
      outputPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--benchmark-in" && argv[i + 1]) {
      benchmarkInPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--strict") {
      strictBenchmark = true;
    }
  }

  if (process.env.LAWMIND_BENCHMARK_STRICT?.trim() === "1") {
    strictBenchmark = true;
  }

  return { workspaceDir, outputPath, benchmarkInPath, strictBenchmark, benchmarkThreshold };
}

async function loadBenchmarkResults(filePath: string): Promise<{
  results: BenchmarkResult[];
  filePresent: boolean;
  eligible: boolean;
  excludedReason?: string;
}> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const classified = classifyReleaseBenchmarkFile({
      readError: code === "ENOENT" ? "missing" : "unreadable",
    });
    return {
      results: classified.results,
      filePresent: classified.filePresent,
      eligible: classified.eligible,
      excludedReason: classified.reason,
    };
  }
  const classified = classifyReleaseBenchmarkFile({ raw });
  return {
    results: classified.results,
    filePresent: classified.filePresent,
    eligible: classified.eligible,
    excludedReason: classified.reason,
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const qualityDashboardMarkdown = await buildQualityDashboardMarkdown(opts.workspaceDir);
  const {
    results: benchmarkResults,
    filePresent,
    eligible,
    excludedReason: benchmarkExcludedReason,
  } = await loadBenchmarkResults(opts.benchmarkInPath);

  const gatePass = benchmarkPassesThreshold(benchmarkResults, opts.benchmarkThreshold);
  const knownRisks: string[] = [];
  if (benchmarkExcludedReason) {
    knownRisks.push(
      `Benchmark results not counted toward release gate (${benchmarkExcludedReason}). ` +
        "Re-run `pnpm lawmind:benchmark -- --mode scripted --out dist/lawmind-benchmark.json` (or --mode real) for gate evidence.",
    );
  } else if (!filePresent) {
    knownRisks.push(
      "Benchmark file absent. That is not gate evidence. " +
        "Run `pnpm lawmind:benchmark -- --mode scripted --out dist/lawmind-benchmark.json` (or --mode real) before release.",
    );
  } else if (!gatePass) {
    knownRisks.push(
      `Benchmark gate failed (mean score below ${(opts.benchmarkThreshold * 100).toFixed(0)}%).`,
    );
  }

  // True-manuscript gate: when fixtures are present they must all pass; an
  // honest skip is a known risk for release (quality proof not shown).
  const trueManuscriptGate = inspectTrueManuscriptGate();
  const trueManuscriptLines: string[] = [];
  const trueManuscriptRun = await runTrueManuscriptGateCli({
    workspaceDir: opts.workspaceDir,
    log: (line) => trueManuscriptLines.push(line),
  });
  if (!trueManuscriptGate.present) {
    knownRisks.push(
      "True-manuscript fixtures absent (honest SKIP). Before release, place desensitized " +
        "real .docx/.pdf into fixtures/lawmind-true-manuscript/ and run " +
        "`LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript` until all pass.",
    );
  } else if (!trueManuscriptRun.ok) {
    knownRisks.push(
      "True-manuscript gate FAILED against local fixtures. Do not release until " +
        "`pnpm lawmind:true-manuscript` is green.",
    );
  }

  // 发行产物：签名/公证/自动更新清单。产物不存在时诚实报「未评估」并计入风险。
  const releaseArtifacts = inspectReleaseArtifacts(
    path.resolve(process.cwd(), "apps/lawmind-desktop/release"),
  );
  const releaseArtifactLines = formatReleaseArtifactsReport(releaseArtifacts);
  knownRisks.push(...releaseArtifactLines.risks);

  /**
   * 交付北极星：水平 + 趋势。
   *
   * 这一节与其他章节的性质不同：别处在核「东西齐不齐」，这里在核
   * 「**它有没有让律师更省事**」。所以没有证据时不能留空——
   * 空节会被读成「没问题」，而实际是「还没验证」。证据不足一律计入 knownRisks。
   */
  const northStar = persistNorthStarSnapshot(opts.workspaceDir);
  const northStarTrend = persistNorthStarTrend(opts.workspaceDir);
  const pctText = (rate: number | null): string =>
    rate == null ? "尚无样本" : `${(rate * 100).toFixed(1)}%`;
  const northStarLines: string[] = [
    `- 一次通过：${pctText(northStar.firstPassRate)}（样本 ${northStar.samples.firstPassOk + northStar.samples.firstPassFail}）`,
    `- 机械核对逃逸：${pctText(northStar.lintEscapeRate)}（分母 ${northStar.samples.deliveries} 次交付）`,
    `- 无干预完成：${pctText(northStar.unattendedCompleteRate)}`,
    `- 审阅时长中位：${
      northStar.reviewDurationMsMedian == null
        ? "尚无样本"
        : `${Math.round(northStar.reviewDurationMsMedian / 1000)} 秒`
    }`,
  ];
  /**
   * 样本太薄时**不撤数字**（口径归 `north-star.ts` 的 v2 决定，不在这里改），
   * 但必须给读者一句提醒——否则「0.0%（样本 1）」会被当成测量结果。
   * 阈值与趋势分桶用同一个常量，避免两处口径漂移。
   */
  const firstPassTotal = northStar.samples.firstPassOk + northStar.samples.firstPassFail;
  if (firstPassTotal > 0 && firstPassTotal < MIN_DELIVERIES_PER_BUCKET) {
    northStarLines.push(
      `- 注意：一次通过样本仅 ${firstPassTotal}，低于 ${MIN_DELIVERIES_PER_BUCKET}——` +
        "该比率会剧烈跳动，不足以作为结论（口径归 north-star v2，此处只提醒，不改算）。",
    );
  }
  if (northStarTrend.trend) {
    const t = northStarTrend.trend;
    northStarLines.push(
      `- 趋势（近 ${northStarTrend.windowDays} 天，${t.usableBuckets} 周样本足够）：` +
        `一次通过 ${(t.firstPassRateDelta * 100).toFixed(1)} 个百分点，` +
        `逃逸 ${(t.lintEscapeRateDelta * 100).toFixed(1)} 个百分点，` +
        (t.rewriteAmplitudeDeltaChars == null
          ? `改稿幅度未参与（${t.amplitudeUnavailableReason ?? "样本不足"}）`
          : `改稿幅度中位 ${Math.round(t.rewriteAmplitudeDeltaChars)} 字`) +
        ` → ${t.direction}`,
    );
  } else {
    northStarLines.push(`- 趋势：未判断 —— ${northStarTrend.trendUnavailableReason ?? "样本不足"}`);
  }
  const northStarProven =
    Boolean(northStarTrend.trend) &&
    northStarTrend.trend?.direction !== "worsening" &&
    northStarTrend.trend?.direction !== "mixed";
  if (!northStarProven) {
    knownRisks.push(
      "Delivery north star not proven: no usable week-over-week trend in this workspace. " +
        "水平值会被案件难度与改版污染，只有同一工作区的前后期对比能支撑「越用越省事」。",
    );
  }

  const report = buildReleaseReadinessReportMarkdown({
    benchmarkResults,
    benchmarkTasks: BUILTIN_BENCHMARK_TASKS,
    qualityDashboardMarkdown,
    knownRisks,
    trueManuscript: {
      reportLine: formatTrueManuscriptGateReport(trueManuscriptGate),
      detail: trueManuscriptLines.slice(1),
    },
    releaseArtifacts: { lines: releaseArtifactLines.lines },
    northStar: { lines: northStarLines, proven: northStarProven },
    verifyCommands: [
      "pnpm lawmind:verify",
      "pnpm lawmind:benchmark -- --mode scripted --out dist/lawmind-benchmark.json",
      "LAWMIND_REQUIRE_TRUE_MANUSCRIPT=1 pnpm lawmind:true-manuscript",
      "pnpm lawmind:desktop:dist",
      "pnpm lawmind:desktop:e2e:pr",
      "pnpm lawmind:quarterly-demo",
      "pnpm lawmind:release-readiness",
      "pnpm lawmind:docs:build",
    ],
  });

  if (opts.outputPath) {
    await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
    await fs.writeFile(opts.outputPath, report, "utf8");
    console.log(`[Release Readiness] wrote ${opts.outputPath}`);
  } else {
    console.log(report);
  }

  const benchmarkExit = releaseReadinessBenchmarkExit({
    filePresent,
    eligible,
    gatePass,
    strict: opts.strictBenchmark,
  });
  if (benchmarkExit !== 0) {
    const why =
      benchmarkExcludedReason ??
      (!filePresent ? "benchmark 文件不在，且当前是严格模式" : "benchmark 均分低于阈值");
    console.error(`[Release Readiness] benchmark gate failed: ${why}`);
    process.exitCode = benchmarkExit;
  }
}

main().catch((err) => {
  console.error("[Release Readiness] failed:", err);
  process.exitCode = 1;
});
