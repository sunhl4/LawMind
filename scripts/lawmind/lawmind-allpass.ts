/**
 * Rule-level all-pass CLI.
 *
 * Prints PASS / FAIL / SKIP. Without a model arm it prints an honest SKIP: the
 * fixtures and the scorer are validated, but no claim is made about any model.
 *
 *   pnpm lawmind:allpass                 # 校验夹具 + 诚实 SKIP
 *   pnpm lawmind:allpass --validate      # 只校验夹具（CI 用）
 *   pnpm lawmind:allpass --arm oracle    # 夹具自检：用期望值回放，证明评分器接线
 *   pnpm lawmind:allpass --workspace <dir>   # 另存报告到 <dir>/lawmind/metrics/
 *
 * LAWMIND_REQUIRE_ALLPASS=1 → 非 pass 即非零退出（nightly / 本地；默认 CI 不挡）。
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentModelConfig } from "../../src/lawmind/agent/types.js";
import { runRuleAllPassModelArm } from "../../src/lawmind/evaluation/rule-allpass-model-arm.js";
import {
  buildRuleAllPassReportMarkdown,
  loadRuleAllPassFixtures,
  oracleClassifications,
  scoreRuleAllPassCase,
  summarizeRuleAllPass,
  validateRuleAllPassFixtures,
  type RuleAllPassReport,
} from "../../src/lawmind/evaluation/rule-allpass.js";
import { getProviderDefinition } from "../../src/lawmind/models/providers.js";
import type { RuleClassification } from "../../src/lawmind/review/rules.js";

const argv = process.argv.slice(2);
const validateOnly = argv.includes("--validate");
const jsonOut = argv.includes("--json");

let arm = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--arm" && argv[i + 1]) {
    arm = argv[i + 1].trim();
    i += 1;
  }
}

let modelId = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--model" && argv[i + 1]) {
    modelId = argv[i + 1].trim();
    i += 1;
  }
}

let maxCases = 0;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--max-cases" && argv[i + 1]) {
    maxCases = Number.parseInt(argv[i + 1], 10) || 0;
    i += 1;
  }
}

let trials = 1;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--trials" && argv[i + 1]) {
    trials = Math.max(1, Number.parseInt(argv[i + 1], 10) || 1);
    i += 1;
  }
}

let concurrency = 3;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--concurrency" && argv[i + 1]) {
    concurrency = Math.max(1, Number.parseInt(argv[i + 1], 10) || 3);
    i += 1;
  }
}

let workspaceDir = "";
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--workspace" && argv[i + 1]) {
    workspaceDir = path.resolve(process.cwd(), argv[i + 1]);
    i += 1;
  }
}

const require = ["1", "true", "yes"].includes(
  (process.env.LAWMIND_REQUIRE_ALLPASS ?? "").trim().toLowerCase(),
);

const loaded = loadRuleAllPassFixtures();
const problems = validateRuleAllPassFixtures(loaded);

function persist(report: RuleAllPassReport): string | undefined {
  if (!workspaceDir) {
    return undefined;
  }
  const dir = path.join(workspaceDir, "lawmind", "metrics");
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "allpass-report.json");
  const mdPath = path.join(dir, "allpass-report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, buildRuleAllPassReportMarkdown(report), "utf8");
  return jsonPath;
}

function finish(report: RuleAllPassReport, exitCode: number): never {
  const saved = persist(report);
  if (jsonOut) {
    console.log(JSON.stringify({ ...report, savedTo: saved ?? null }, null, 2));
  } else {
    console.log(buildRuleAllPassReportMarkdown(report));
    if (saved) {
      console.log(`报告已写入：${saved}`);
    }
  }
  process.exit(exitCode);
}

// ── 1. 夹具完整性 ────────────────────────────────────────────────
if (problems.length > 0) {
  const summary = summarizeRuleAllPass(loaded.cases, [], problems);
  finish(
    {
      generatedAt: new Date().toISOString(),
      status: "fail",
      dir: loaded.dir,
      summary,
      harnessSelfTest: false,
      reportZh: "",
    },
    1,
  );
}

if (loaded.cases.length === 0) {
  finish(
    {
      generatedAt: new Date().toISOString(),
      status: "skip",
      dir: loaded.dir,
      summary: summarizeRuleAllPass([], []),
      harnessSelfTest: false,
      reportZh: "",
    },
    require ? 1 : 0,
  );
}

// ── 2. 只校验夹具 ────────────────────────────────────────────────
if (validateOnly) {
  const summary = summarizeRuleAllPass(loaded.cases, []);
  finish(
    {
      generatedAt: new Date().toISOString(),
      status: "pass",
      mode: "validate",
      dir: loaded.dir,
      summary,
      harnessSelfTest: false,
      reportZh: "",
    },
    0,
  );
}

// ── 3. 执行臂 ────────────────────────────────────────────────────
if (!arm) {
  finish(
    {
      generatedAt: new Date().toISOString(),
      status: "skip",
      dir: loaded.dir,
      summary: summarizeRuleAllPass(loaded.cases, []),
      harnessSelfTest: false,
      reportZh: "",
    },
    require ? 1 : 0,
  );
}

function resolveDeepSeekModel(explicit: string): { config: AgentModelConfig } | { error: string } {
  const provider = getProviderDefinition("deepseek");
  let apiKey = "";
  for (const key of provider.apiKeyEnvKeys) {
    const value = process.env[key]?.trim();
    if (value) {
      apiKey = value;
      break;
    }
  }
  if (!apiKey) {
    return {
      error: `未配置 DeepSeek key。设置其中之一：${provider.apiKeyEnvKeys.join(" / ")}`,
    };
  }
  return {
    config: {
      provider: "openai-compatible",
      baseUrl: provider.defaultBaseUrl,
      apiKey,
      model: explicit || "deepseek-chat",
      temperature: 0,
      maxRetries: 1,
      timeoutMs: 120_000,
      ...(process.env.LAWMIND_ALLPASS_SEED
        ? { seed: Number.parseInt(process.env.LAWMIND_ALLPASS_SEED, 10) }
        : {}),
    },
  };
}

if (arm === "oracle") {
  const scores = loaded.cases.map((c) => {
    const actual: RuleClassification[] = oracleClassifications(c);
    return scoreRuleAllPassCase(c, actual);
  });
  const summary = summarizeRuleAllPass(loaded.cases, scores);
  const status: RuleAllPassReport["status"] = summary.failed === 0 ? "pass" : "fail";

  finish(
    {
      generatedAt: new Date().toISOString(),
      status,
      dir: loaded.dir,
      arm: "oracle",
      summary,
      harnessSelfTest: true,
      reportZh: "",
    },
    status === "pass" ? 0 : 1,
  );
}

if (arm !== "deepseek") {
  console.error(
    `未知执行臂：${arm}。可用：oracle（夹具自检）、deepseek（真实模型）。` +
      "未知臂不会给出任何分数。",
  );
  process.exit(2);
}

// ── 4. 真实模型臂（DeepSeek） ────────────────────────────────────
const resolved = resolveDeepSeekModel(modelId);
if ("error" in resolved) {
  console.error(resolved.error);
  // 配置缺失不是「零分」，不能落成 fail 报告。
  process.exit(2);
}

const armStart = Date.now();
const modelRun = await runRuleAllPassModelArm({
  cases: loaded.cases,
  chatModel: resolved.config,
  concurrency,
  trials,
  ...(maxCases > 0 ? { maxCases } : {}),
  onProgress: (event) => {
    if (!jsonOut) {
      process.stderr.write(`\r[${event.done}/${event.total}] ${event.caseId} ${event.ruleId}   `);
    }
  },
});
if (!jsonOut) {
  process.stderr.write("\n");
}

const scoredCases = loaded.cases.slice(0, modelRun.cases.length);
const scores = modelRun.cases.map((c) => c.score);
const summary = summarizeRuleAllPass(scoredCases, scores);
const status: RuleAllPassReport["status"] =
  modelRun.stoppedEarly || modelRun.failures.length > 0
    ? "fail"
    : summary.failed === 0
      ? "pass"
      : "fail";

finish(
  {
    generatedAt: new Date().toISOString(),
    status,
    dir: loaded.dir,
    arm: modelRun.arm,
    summary,
    harnessSelfTest: false,
    modelArm: {
      model: modelRun.model,
      totalCalls: modelRun.totalCalls,
      stoppedEarly: modelRun.stoppedEarly,
      elapsedMs: Date.now() - armStart,
      trials,
      failures: modelRun.failures,
      perCase: modelRun.cases.map((c) => ({
        caseId: c.caseId,
        pass: c.score.pass,
        missing: c.score.missing,
        mismatches: c.score.mismatches,
        perRule: c.perRule,
      })),
    },
    reportZh: "",
  },
  status === "pass" ? 0 : 1,
);
