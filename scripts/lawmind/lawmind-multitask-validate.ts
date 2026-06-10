import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Options = {
  withPlaywright: boolean;
  strict: boolean;
};

type CheckArea = "functional" | "ui" | "quality";
type CheckStatus = "passed" | "failed" | "skipped";

type CheckDefinition = {
  id: string;
  area: CheckArea;
  required: boolean;
  description: string;
  command: string;
  args: string[];
  canSkip?: (env: NodeJS.ProcessEnv) => string | undefined;
};

type CheckResult = {
  id: string;
  area: CheckArea;
  required: boolean;
  description: string;
  status: CheckStatus;
  durationMs: number;
  commandLine: string;
  reason?: string;
};

type ValidationReport = {
  runAt: string;
  repoRoot: string;
  options: Options;
  definitionOfDone: string[];
  checks: CheckResult[];
  summary: {
    passed: number;
    failed: number;
    skipped: number;
    requiredFailed: number;
    releaseReady: boolean;
  };
};

const DOD = [
  "Task Contract 模板已落地，字段覆盖 goal/input/output/acceptance/risk/rollback/owner/parallel boundary。",
  "功能验证闭环可执行，并覆盖 workflow/collaboration 核心路径。",
  "UI 验证闭环可重复执行，至少包含 renderer 关键 smoke。",
  "治理门禁可执行（guardrail + 9 项 audit matrix）并纳入 strict 验证链路。",
  "平台契约已冻结（LAWMIND-PLATFORM-CONTRACTS + src/lawmind/platform/contracts.ts）并纳入 strict 校验。",
  "时间维度可观测指标可生成（lead time/retry/cancel/failure/conflict/first-pass）。",
  "质量门禁已定义且脚本输出结构化报告（JSON + Markdown）。",
  "所有 required 检查通过后才判定 releaseReady。",
];

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    withPlaywright: false,
    strict: false,
  };
  for (const token of argv) {
    if (token === "--with-playwright") {
      opts.withPlaywright = true;
      continue;
    }
    if (token === "--strict") {
      opts.strict = true;
      continue;
    }
    if (token === "--help") {
      console.log(
        "Usage: node --import tsx scripts/lawmind/lawmind-multitask-validate.ts [--with-playwright] [--strict]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return opts;
}

function asCommandLine(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function runCheck(def: CheckDefinition): CheckResult {
  const skipReason = def.canSkip?.(process.env);
  if (skipReason) {
    return {
      id: def.id,
      area: def.area,
      required: def.required,
      description: def.description,
      status: "skipped",
      durationMs: 0,
      commandLine: asCommandLine(def.command, def.args),
      reason: skipReason,
    };
  }

  const started = Date.now();
  const result = spawnSync(def.command, def.args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
    stdio: "pipe",
    encoding: "utf8",
  });
  const durationMs = Date.now() - started;

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout.trim()) {
    process.stdout.write(stdout);
  }
  if (stderr.trim()) {
    process.stderr.write(stderr);
  }

  if (result.status === 0) {
    return {
      id: def.id,
      area: def.area,
      required: def.required,
      description: def.description,
      status: "passed",
      durationMs,
      commandLine: asCommandLine(def.command, def.args),
    };
  }
  const reasonParts: string[] = [];
  if (result.status !== null) {
    reasonParts.push(`exit=${result.status}`);
  }
  if (result.signal) {
    reasonParts.push(`signal=${result.signal}`);
  }
  if (result.error) {
    reasonParts.push(`error=${result.error.message}`);
  }
  if (stderr.trim()) {
    const lastErrorLine = stderr.trim().split("\n").at(-1);
    if (lastErrorLine) {
      reasonParts.push(`stderr=${lastErrorLine.slice(0, 180)}`);
    }
  }
  return {
    id: def.id,
    area: def.area,
    required: def.required,
    description: def.description,
    status: "failed",
    durationMs,
    commandLine: asCommandLine(def.command, def.args),
    reason: reasonParts.join(", ") || "exit=unknown",
  };
}

function defineChecks(opts: Options): CheckDefinition[] {
  const checks: CheckDefinition[] = [
    {
      id: "governance-platform-contracts",
      area: "quality",
      required: true,
      description: "Platform contracts document and type file exist",
      command: "node",
      args: ["--import", "tsx", "scripts/lawmind/lawmind-platform-contracts-check.ts"],
    },
    {
      id: "governance-guardrail",
      area: "quality",
      required: true,
      description: "Guardrail checks for scope/acceptance/rollback/parallel boundary",
      command: "pnpm",
      args: ["run", "lawmind:multitask:guardrail"],
    },
    {
      id: "governance-audit-matrix",
      area: "quality",
      required: true,
      description: "Nine-part multitask audit matrix generation",
      command: "pnpm",
      args: ["run", "lawmind:multitask:audit", ...(opts.strict ? ["--", "--strict"] : [])],
    },
    {
      id: "functional-workflow-tests",
      area: "functional",
      required: true,
      description: "Workflow template + collaboration server route tests",
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        "src/lawmind/agent/collaboration/workspace-workflow-templates.test.ts",
        "apps/lawmind-desktop/server/lawmind-server-route-collaboration.test.ts",
      ],
    },
    {
      id: "ui-renderer-smoke",
      area: "ui",
      required: true,
      description: "Desktop renderer smoke (Vitest) for shell/chat/explorer",
      command: "pnpm",
      args: [
        "exec",
        "vitest",
        "run",
        "apps/lawmind-desktop/src/renderer/lawmind-app-shell.test.ts",
        "apps/lawmind-desktop/src/renderer/lawmind-chat-shell.test.ts",
        "apps/lawmind-desktop/src/renderer/lawmind-explorer-lawyer-view.test.ts",
      ],
    },
    {
      id: "quality-desktop-typecheck",
      area: "quality",
      required: true,
      description: "Desktop TypeScript typecheck gate",
      command: "pnpm",
      args: ["--filter", "lawmind-desktop", "typecheck"],
    },
    {
      id: "quality-observability-baseline",
      area: "quality",
      required: true,
      description: "Windowed multitask observability baseline report",
      command: "pnpm",
      args: ["run", "lawmind:multitask:observability", "--", "--window-days", "14"],
    },
    {
      id: "ui-http-smoke",
      area: "ui",
      required: true,
      description: "Desktop local API HTTP smoke (auto-starts local server)",
      command: "pnpm",
      args: ["run", "lawmind:desktop:http-smoke"],
    },
  ];

  if (opts.withPlaywright) {
    checks.push({
      id: "ui-playwright-smoke",
      area: "ui",
      required: opts.strict,
      description: "Playwright renderer smoke suite",
      command: "pnpm",
      args: ["--filter", "lawmind-desktop", "exec", "playwright", "test", "e2e/smoke.spec.ts"],
    });
  } else {
    checks.push({
      id: "ui-playwright-smoke",
      area: "ui",
      required: false,
      description: "Playwright renderer smoke suite",
      command: "pnpm",
      args: ["--filter", "lawmind-desktop", "exec", "playwright", "test", "e2e/smoke.spec.ts"],
      canSkip: () => "disabled by default; rerun with --with-playwright",
    });
  }

  return checks;
}

function buildSummary(results: CheckResult[]) {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const requiredFailed = results.filter((r) => r.required && r.status === "failed").length;
  return {
    passed,
    failed,
    skipped,
    requiredFailed,
    releaseReady: requiredFailed === 0,
  };
}

function toMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push("# LawMind Multitask Baseline Validation Report");
  lines.push("");
  lines.push(`- runAt: ${report.runAt}`);
  lines.push(`- repoRoot: ${report.repoRoot}`);
  lines.push(
    `- options: withPlaywright=${report.options.withPlaywright}, strict=${report.options.strict}`,
  );
  lines.push("");
  lines.push("## Definition of Done");
  for (const item of report.definitionOfDone) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Check Results");
  for (const check of report.checks) {
    lines.push(
      `- [${check.status.toUpperCase()}] ${check.id} (${check.area}, required=${check.required})`,
    );
    lines.push(`  - description: ${check.description}`);
    lines.push(`  - command: \`${check.commandLine}\``);
    lines.push(`  - durationMs: ${check.durationMs}`);
    if (check.reason) {
      lines.push(`  - reason: ${check.reason}`);
    }
  }
  lines.push("");
  lines.push("## Summary");
  lines.push(`- passed: ${report.summary.passed}`);
  lines.push(`- failed: ${report.summary.failed}`);
  lines.push(`- skipped: ${report.summary.skipped}`);
  lines.push(`- requiredFailed: ${report.summary.requiredFailed}`);
  lines.push(`- releaseReady: ${report.summary.releaseReady}`);
  return `${lines.join("\n")}\n`;
}

function writeReport(report: ValidationReport): { jsonPath: string; mdPath: string } {
  const outDir = path.resolve(process.cwd(), "dist", "lawmind", "multitask-validation");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `report-${stamp}.json`);
  const mdPath = path.join(outDir, `report-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const checks = defineChecks(opts);
  const results: CheckResult[] = [];

  console.log("[Multitask Validate] Starting checks...");
  for (const check of checks) {
    console.log(`\n[Multitask Validate] -> ${check.id}: ${check.description}`);
    const result = runCheck(check);
    results.push(result);
    console.log(
      `[Multitask Validate] <- ${check.id}: ${result.status} (${result.durationMs}ms)${
        result.reason ? `, reason=${result.reason}` : ""
      }`,
    );
  }

  const report: ValidationReport = {
    runAt: new Date().toISOString(),
    repoRoot: process.cwd(),
    options: opts,
    definitionOfDone: DOD,
    checks: results,
    summary: buildSummary(results),
  };
  const paths = writeReport(report);
  console.log("\n[Multitask Validate] Report written:");
  console.log(`- ${paths.jsonPath}`);
  console.log(`- ${paths.mdPath}`);

  if (!report.summary.releaseReady) {
    process.exitCode = 1;
    return;
  }
  console.log("[Multitask Validate] releaseReady=true");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[Multitask Validate] failed:", message);
  process.exitCode = 1;
});
