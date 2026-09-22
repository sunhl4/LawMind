import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildBenchmarkReportMarkdown,
  runBenchmarks,
  runEngineShadowReplay,
  selectReleaseGateBenchmarkResults,
  type BenchmarkModelMode,
  type BenchmarkResult,
  type EngineShadowReplayReport,
  type LawMindEngineForBenchmark,
} from "../../src/lawmind/evaluation/index.js";
import {
  BUILTIN_SHADOW_FIXTURES,
  loadShadowFixtures,
  runShadowReplay,
} from "../../src/lawmind/evaluation/shadow-replay.js";
import { createLawMindEngine } from "../../src/lawmind/index.js";
import { buildLawMindCliAdapters } from "./lawmind-engine-adapters.js";
import { loadLawMindEnv } from "./lawmind-env-loader.js";

type BenchmarkMode = BenchmarkModelMode;

type Options = {
  workspaceDir: string;
  outputJsonPath: string;
  mode: BenchmarkMode;
  threshold: number;
  strict: boolean;
  withRealModel: boolean;
  shadow: boolean;
  shadowEngine: boolean;
};

const ALLOWED_MODES = new Set<BenchmarkMode>(["mock", "scripted", "real"]);

function parseArgs(argv: string[]): Options {
  let workspaceDir = path.resolve(process.cwd(), "workspace");
  let outputJsonPath = path.resolve(process.cwd(), "dist/lawmind-benchmark.json");
  let mode: BenchmarkMode = "mock";
  let threshold = 0.8;
  let strict = false;
  let withRealModel = false;
  let shadow = false;
  let shadowEngine = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) {
      workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--out" && argv[i + 1]) {
      outputJsonPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--mode" && argv[i + 1]) {
      const next = argv[i + 1] as BenchmarkMode;
      if (!ALLOWED_MODES.has(next)) {
        console.error(`[LawMind Benchmark] invalid mode "${next}". Allowed: mock, scripted, real.`);
        process.exit(1);
      }
      mode = next;
      i += 1;
    } else if (arg === "--threshold" && argv[i + 1]) {
      threshold = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--with-real-model") {
      withRealModel = true;
    } else if (arg === "--real-model") {
      mode = "real";
    } else if (arg === "--shadow") {
      shadow = true;
    } else if (arg === "--shadow-engine") {
      shadowEngine = true;
    }
  }

  if (process.env.LAWMIND_BENCHMARK_STRICT?.trim() === "1") {
    strict = true;
  }
  if (process.env.LAWMIND_BENCHMARK_REAL_MODEL?.trim() === "1") {
    withRealModel = true;
  }
  if (shadowEngine && mode === "mock") {
    mode = "scripted";
  }

  return {
    workspaceDir,
    outputJsonPath,
    mode,
    threshold,
    strict,
    withRealModel,
    shadow,
    shadowEngine,
  };
}

function validateRealModelGate(opts: Options, useRealModel: boolean): void {
  if (!useRealModel) {
    console.error(
      `[LawMind Benchmark] real mode requires real model adapters configured via environment.`,
    );
    process.exit(1);
  }
  const realModelGate =
    opts.withRealModel || process.env.LAWMIND_BENCHMARK_REAL_MODEL?.trim() === "1";
  if (!realModelGate) {
    console.error(
      `[LawMind Benchmark] real mode requires explicit opt-in: pass --with-real-model or set LAWMIND_BENCHMARK_REAL_MODEL=1.`,
    );
    process.exit(1);
  }
}

function shadowReportToBenchmarkResults(report: EngineShadowReplayReport): BenchmarkResult[] {
  return report.results.map((row) => ({
    benchmarkId: `shadow:${row.id}`,
    runId: `shadow-${row.id}-${randomUUID()}`,
    ranAt: new Date().toISOString(),
    modelMode: "scripted" as BenchmarkMode,
    taskCompleted: row.status === "ok",
    kindMatched: true,
    keywordHitRate: row.similarity,
    riskLevelMatched: true,
    reviewGateMatched: true,
    sourceCount: 0,
    claimCount: 0,
    latencyMs: 0,
    score: row.similarity,
  }));
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const loaded = loadLawMindEnv();
  const { adapters, useRealModel, modelHint } = buildLawMindCliAdapters(opts.workspaceDir, {
    forceMock: opts.mode !== "real",
  });

  if (opts.mode === "real") {
    validateRealModelGate(opts, useRealModel);
  }

  let results: BenchmarkResult[] = [];
  let shadowReport: ReturnType<typeof runShadowReplay> | undefined;
  let engineShadowReport: EngineShadowReplayReport | undefined;

  if (opts.mode === "mock" || opts.mode === "real") {
    const engine = createLawMindEngine({ workspaceDir: opts.workspaceDir, adapters });
    results = await runBenchmarks(engine as LawMindEngineForBenchmark, BUILTIN_BENCHMARK_TASKS, {
      modelHint: opts.mode === "mock" ? "mock-adapters" : modelHint,
      modelMode: opts.mode,
    });
  } else if (opts.mode === "scripted") {
    engineShadowReport = await runEngineShadowReplay(BUILTIN_SHADOW_FIXTURES, { realModel: false });
    results = shadowReportToBenchmarkResults(engineShadowReport);
  }

  if (opts.shadow) {
    shadowReport = runShadowReplay(loadShadowFixtures());
  }
  if (opts.shadowEngine && opts.mode !== "scripted") {
    engineShadowReport = await runEngineShadowReplay(BUILTIN_SHADOW_FIXTURES, { realModel: false });
  }

  const avgScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;
  const gatePass = benchmarkPassesThreshold(results, opts.threshold);
  const gate = selectReleaseGateBenchmarkResults({ modelMode: opts.mode, results });

  const payload = {
    generatedAt: new Date().toISOString(),
    workspaceDir: opts.workspaceDir,
    modelMode: opts.mode,
    envFile: loaded.path,
    threshold: opts.threshold,
    gatePass,
    avgScore,
    taskCount: BUILTIN_BENCHMARK_TASKS.length,
    results,
    tasks: BUILTIN_BENCHMARK_TASKS.map((t) => ({
      benchmarkId: t.benchmarkId,
      category: t.category,
      description: t.description,
    })),
    ...(shadowReport ? { shadow: shadowReport.summary } : {}),
    ...(engineShadowReport ? { shadowEngine: engineShadowReport.summary } : {}),
  };

  await fs.mkdir(path.dirname(opts.outputJsonPath), { recursive: true });
  await fs.writeFile(opts.outputJsonPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(buildBenchmarkReportMarkdown(results, BUILTIN_BENCHMARK_TASKS));
  if (shadowReport) {
    console.log(shadowReport.summary.reportZh);
  }
  if (engineShadowReport) {
    console.log(engineShadowReport.summary.reportZh);
  }
  console.log(`[LawMind Benchmark] mode=${opts.mode} wrote ${opts.outputJsonPath}`);
  console.log(
    `[LawMind Benchmark] avg=${(avgScore * 100).toFixed(1)}% gate=${gatePass ? "pass" : "fail"} threshold=${(opts.threshold * 100).toFixed(0)}% releaseGate=${gate.eligible ? "eligible" : "not-eligible"}${gate.reason ? ` (${gate.reason})` : ""}`,
  );

  if (opts.strict && !gatePass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[LawMind Benchmark] failed:", err);
  process.exitCode = 1;
});
