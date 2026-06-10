import fs from "node:fs/promises";
import path from "node:path";
import {
  BUILTIN_BENCHMARK_TASKS,
  benchmarkPassesThreshold,
  buildQualityDashboardMarkdown,
  buildReleaseReadinessReportMarkdown,
  type BenchmarkResult,
} from "../../src/lawmind/evaluation/index.js";

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
    }
  }

  if (process.env.LAWMIND_BENCHMARK_STRICT?.trim() === "1") {
    strictBenchmark = true;
  }

  return { workspaceDir, outputPath, benchmarkInPath, strictBenchmark, benchmarkThreshold };
}

async function loadBenchmarkResults(
  filePath: string,
): Promise<{ results: BenchmarkResult[]; loaded: boolean }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { results?: BenchmarkResult[] };
    if (Array.isArray(parsed.results) && parsed.results.length > 0) {
      return { results: parsed.results, loaded: true };
    }
  } catch {
    // missing or invalid — release report will note benchmark not supplied
  }
  return { results: [], loaded: false };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const qualityDashboardMarkdown = await buildQualityDashboardMarkdown(opts.workspaceDir);
  const { results: benchmarkResults, loaded: benchmarkLoaded } = await loadBenchmarkResults(
    opts.benchmarkInPath,
  );

  const gatePass = benchmarkPassesThreshold(benchmarkResults, opts.benchmarkThreshold);
  const knownRisks: string[] = [];
  if (!benchmarkLoaded) {
    knownRisks.push(
      "Benchmark results not found. Run `pnpm lawmind:benchmark -- --out dist/lawmind-benchmark.json` first.",
    );
  } else if (!gatePass) {
    knownRisks.push(
      `Benchmark gate failed (mean score below ${(opts.benchmarkThreshold * 100).toFixed(0)}%).`,
    );
  }

  const report = buildReleaseReadinessReportMarkdown({
    benchmarkResults,
    benchmarkTasks: BUILTIN_BENCHMARK_TASKS,
    qualityDashboardMarkdown,
    knownRisks,
    verifyCommands: [
      "pnpm lawmind:verify",
      "pnpm lawmind:benchmark -- --out dist/lawmind-benchmark.json",
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

  if (opts.strictBenchmark && (!benchmarkLoaded || !gatePass)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[Release Readiness] failed:", err);
  process.exitCode = 1;
});
