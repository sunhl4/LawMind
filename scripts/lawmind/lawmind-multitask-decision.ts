import fs from "node:fs";
import path from "node:path";

type DecisionInput = {
  taskComplexity: number;
  workspaceVolatility: number;
  dependencyDensity: number;
  acceptancePressure: number;
  contextIsolationRequired: number;
};

type DecisionOptions = {
  input: DecisionInput;
  outDir: string;
};

type DecisionOutput = {
  recommendation: "task-first" | "workspace-first";
  score: {
    taskFirst: number;
    workspaceFirst: number;
  };
  rationale: string[];
};

type DecisionReport = {
  reportType: "multitask-decision";
  runAt: string;
  input: DecisionInput;
  output: DecisionOutput;
};

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 3;
  }
  return Math.max(1, Math.min(5, Math.round(value)));
}

function parseArgs(argv: string[]): DecisionOptions {
  const opts: DecisionOptions = {
    input: {
      taskComplexity: 3,
      workspaceVolatility: 3,
      dependencyDensity: 3,
      acceptancePressure: 3,
      contextIsolationRequired: 3,
    },
    outDir: path.join(process.cwd(), "dist", "lawmind", "multitask-validation"),
  };

  const setScore = (target: keyof DecisionInput, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`invalid numeric value for ${target}: ${value}`);
    }
    opts.input[target] = clampScore(parsed);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--help") {
      console.log(
        "Usage: node --import tsx scripts/lawmind/lawmind-multitask-decision.ts [--task-complexity 1-5] [--workspace-volatility 1-5] [--dependency-density 1-5] [--acceptance-pressure 1-5] [--context-isolation 1-5] [--out-dir <path>]",
      );
      process.exit(0);
    }
    if (token === "--out-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --out-dir");
      }
      opts.outDir = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    if (token === "--task-complexity") {
      setScore("taskComplexity", value);
    } else if (token === "--workspace-volatility") {
      setScore("workspaceVolatility", value);
    } else if (token === "--dependency-density") {
      setScore("dependencyDensity", value);
    } else if (token === "--acceptance-pressure") {
      setScore("acceptancePressure", value);
    } else if (token === "--context-isolation") {
      setScore("contextIsolationRequired", value);
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
    i += 1;
  }

  return opts;
}

function decide(input: DecisionInput): DecisionOutput {
  const taskFirst =
    input.taskComplexity * 1.3 +
    input.acceptancePressure * 1.2 +
    input.contextIsolationRequired * 1.4 +
    (6 - input.workspaceVolatility) * 0.8;

  const workspaceFirst =
    input.workspaceVolatility * 1.4 +
    input.dependencyDensity * 1.3 +
    (6 - input.contextIsolationRequired) * 0.7;

  const recommendation = taskFirst >= workspaceFirst ? "task-first" : "workspace-first";
  const rationale: string[] = [];
  if (recommendation === "task-first") {
    rationale.push("任务复杂度/验收压力/上下文隔离需求更高，优先按任务切片推进。");
    rationale.push("建议先锁定 task contract，再并行拆分 worker。");
  } else {
    rationale.push("工作区波动与依赖耦合更高，优先按 workspace 稳定面分治。");
    rationale.push("建议先冻结共享写路径，再逐步切回 task-first。");
  }
  return {
    recommendation,
    score: {
      taskFirst: Number(taskFirst.toFixed(2)),
      workspaceFirst: Number(workspaceFirst.toFixed(2)),
    },
    rationale,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const output = decide(opts.input);
  const report: DecisionReport = {
    reportType: "multitask-decision",
    runAt: new Date().toISOString(),
    input: opts.input,
    output,
  };
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(opts.outDir, `decision-${stamp}.json`);
  const mdPath = path.join(opts.outDir, `decision-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const markdown = [
    "# LawMind Multitask Decision Report",
    "",
    `- runAt: ${report.runAt}`,
    `- recommendation: ${report.output.recommendation}`,
    `- taskFirst: ${report.output.score.taskFirst}`,
    `- workspaceFirst: ${report.output.score.workspaceFirst}`,
    "",
    "## Rationale",
    ...report.output.rationale.map((item) => `- ${item}`),
    "",
  ].join("\n");
  fs.writeFileSync(mdPath, markdown, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log("[Multitask Decision] report written:");
  console.log(`- ${jsonPath}`);
  console.log(`- ${mdPath}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Multitask Decision] failed: ${message}`);
  process.exitCode = 1;
}
