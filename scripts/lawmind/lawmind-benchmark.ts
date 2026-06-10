import fs from "node:fs/promises";
import path from "node:path";
import {
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildBenchmarkReportMarkdown,
  createLawMindEngine,
  runBenchmarks,
  type LawMindEngineForBenchmark,
} from "../../src/lawmind/index.js";
import { buildLawMindCliAdapters } from "./lawmind-engine-adapters.js";
import { loadLawMindEnv } from "./lawmind-env-loader.js";

type Options = {
  workspaceDir: string;
  outputJsonPath: string;
  realModel: boolean;
  threshold: number;
  strict: boolean;
};

function parseArgs(argv: string[]): Options {
  let workspaceDir = path.resolve(process.cwd(), "workspace");
  let outputJsonPath = path.resolve(process.cwd(), "dist/lawmind-benchmark.json");
  let realModel = false;
  let threshold = 0.8;
  let strict = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace" && argv[i + 1]) {
      workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--out" && argv[i + 1]) {
      outputJsonPath = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (arg === "--real-model") {
      realModel = true;
    } else if (arg === "--threshold" && argv[i + 1]) {
      threshold = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--strict") {
      strict = true;
    }
  }

  if (process.env.LAWMIND_BENCHMARK_STRICT?.trim() === "1") {
    strict = true;
  }

  return { workspaceDir, outputJsonPath, realModel, threshold, strict };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const loaded = loadLawMindEnv();
  const { adapters, useRealModel, modelHint } = buildLawMindCliAdapters(opts.workspaceDir, {
    forceMock: !opts.realModel,
  });

  const engine = createLawMindEngine({ workspaceDir: opts.workspaceDir, adapters });
  const useMock = !(opts.realModel && useRealModel);
  const results = await runBenchmarks(
    engine as LawMindEngineForBenchmark,
    BUILTIN_BENCHMARK_TASKS,
    {
      modelHint: useMock ? "mock-adapters" : modelHint,
      mockScoreAlignment: useMock,
    },
  );

  const avgScore =
    results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0;
  const gatePass = benchmarkPassesThreshold(results, opts.threshold);

  const payload = {
    generatedAt: new Date().toISOString(),
    workspaceDir: opts.workspaceDir,
    modelMode: opts.realModel && useRealModel ? "real-model" : "mock-model",
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
  };

  await fs.mkdir(path.dirname(opts.outputJsonPath), { recursive: true });
  await fs.writeFile(opts.outputJsonPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(buildBenchmarkReportMarkdown(results, BUILTIN_BENCHMARK_TASKS));
  console.log(`[LawMind Benchmark] wrote ${opts.outputJsonPath}`);
  console.log(
    `[LawMind Benchmark] avg=${(avgScore * 100).toFixed(1)}% gate=${gatePass ? "pass" : "fail"} threshold=${(opts.threshold * 100).toFixed(0)}%`,
  );

  if (opts.strict && !gatePass) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[LawMind Benchmark] failed:", err);
  process.exitCode = 1;
});
