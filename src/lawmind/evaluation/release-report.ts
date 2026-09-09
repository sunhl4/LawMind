import { LEGAL_LINT_RULES } from "../lint/rules.js";
import {
  LAWMIND_Q1_GOLDEN_JOURNEYS,
  buildGoldenJourneysMarkdown,
} from "../product/golden-journeys.js";
import type { BenchmarkResult, BenchmarkTask } from "../types.js";
import { buildBenchmarkReportMarkdown } from "./benchmark.js";
import { BUILTIN_LEGAL_REPLAY_FIXTURES } from "./replay-fixtures.js";
import { BUILTIN_SHADOW_FIXTURES } from "./shadow-replay.js";

export type ReleaseReadinessInput = {
  benchmarkResults?: BenchmarkResult[];
  benchmarkTasks?: BenchmarkTask[];
  qualityDashboardMarkdown?: string;
  verifyCommands?: string[];
  knownRisks?: string[];
};

function benchmarkSummary(results: BenchmarkResult[]): { avgScore: number; pass: boolean } {
  if (results.length === 0) {
    return { avgScore: 0, pass: false };
  }
  const avgScore = results.reduce((sum, result) => sum + result.score, 0) / results.length;
  return { avgScore: Math.round(avgScore * 1000) / 1000, pass: avgScore >= 0.8 };
}

export function buildReleaseReadinessReportMarkdown(input: ReleaseReadinessInput = {}): string {
  const benchmarkResults = input.benchmarkResults ?? [];
  const benchmarkTasks = input.benchmarkTasks ?? [];
  const summary = benchmarkSummary(benchmarkResults);
  const commands = input.verifyCommands ?? [
    "pnpm lawmind:verify",
    "pnpm lawmind:compiler-gate",
    "pnpm lawmind:desktop:e2e:pr",
    "pnpm lawmind:quarterly-demo",
    "pnpm lawmind:docs:build",
  ];
  const risks = input.knownRisks ?? [];

  const lines: string[] = [
    "# LawMind Release Readiness Report",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## Readiness Snapshot",
    "",
    `- Golden journeys: ${LAWMIND_Q1_GOLDEN_JOURNEYS.length}`,
    `- Replay fixtures (synthetic regression, non-engine): ${BUILTIN_LEGAL_REPLAY_FIXTURES.length}`,
    `- Legal lint rules: ${LEGAL_LINT_RULES.length}`,
    `- Shadow fixtures (synthetic, draftSource=fixture-static): ${BUILTIN_SHADOW_FIXTURES.length}`,
    `- Benchmark average: ${(summary.avgScore * 100).toFixed(1)}%`,
    `- Benchmark gate target: 80%`,
    `- Benchmark gate: ${summary.pass ? "pass" : "not proven"}`,
    "",
    "## Required Verification Commands",
    "",
    ...commands.map((command) => `- \`${command}\``),
    "",
    "## Golden Journeys",
    "",
    buildGoldenJourneysMarkdown(),
    "",
    "## Benchmark Report",
    "",
    benchmarkResults.length > 0
      ? buildBenchmarkReportMarkdown(benchmarkResults, benchmarkTasks)
      : "No benchmark results supplied. Run the benchmark suite before marking a release ready.",
    "",
    "## Quality Dashboard",
    "",
    input.qualityDashboardMarkdown ?? "No quality dashboard supplied.",
    "",
    "## Known Risks",
    "",
  ];
  if (risks.length === 0) {
    lines.push("- No release-blocking risks recorded in this report.");
  } else {
    lines.push(...risks.map((risk) => `- ${risk}`));
  }
  return lines.join("\n");
}
