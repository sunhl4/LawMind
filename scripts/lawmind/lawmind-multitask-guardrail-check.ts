import fs from "node:fs";
import path from "node:path";

type Options = {
  contractPath: string;
  requestPath: string;
  outDir: string;
};

type Result = {
  rule: string;
  passed: boolean;
  reason: string;
};

type GuardrailReport = {
  reportType: "multitask-guardrail";
  runAt: string;
  options: Options;
  checks: Result[];
  summary: {
    passed: number;
    failed: number;
    releaseReady: boolean;
  };
};

function usage(): string {
  return [
    "Usage: node --import tsx scripts/lawmind/lawmind-multitask-guardrail-check.ts [options]",
    "",
    "Options:",
    "  --contract <path>   Path to task contract template",
    "  --request <path>    Path to multitask request template",
    "  --out-dir <path>    Output directory for guardrail report",
    "  --help              Show this help message",
  ].join("\n");
}

function safeStamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function mustReadFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function checkContains(content: string, token: string, rule: string): Result {
  const passed = content.includes(token);
  return {
    rule,
    passed,
    reason: passed ? `found ${token}` : `missing ${token}`,
  };
}

function parseArgs(argv: string[]): Options {
  const defaults: Options = {
    contractPath: path.join(process.cwd(), "docs", "lawmind", "templates", "task-contract-v1.md"),
    requestPath: path.join(
      process.cwd(),
      "docs",
      "lawmind",
      "templates",
      "multitask-request-template.md",
    ),
    outDir: path.join(process.cwd(), "dist", "lawmind", "multitask-validation"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (token === "--contract" || token === "--request" || token === "--out-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`missing value for ${token}`);
      }
      if (token === "--contract") {
        defaults.contractPath = path.resolve(process.cwd(), value);
      } else if (token === "--request") {
        defaults.requestPath = path.resolve(process.cwd(), value);
      } else {
        defaults.outDir = path.resolve(process.cwd(), value);
      }
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${token}`);
  }

  return defaults;
}

function toMarkdown(report: GuardrailReport): string {
  const lines: string[] = [];
  lines.push("# LawMind Multitask Guardrail Report");
  lines.push("");
  lines.push(`- runAt: ${report.runAt}`);
  lines.push(`- contractPath: ${report.options.contractPath}`);
  lines.push(`- requestPath: ${report.options.requestPath}`);
  lines.push("");
  lines.push("## Checks");
  for (const item of report.checks) {
    lines.push(`- [${item.passed ? "PASS" : "FAIL"}] ${item.rule}: ${item.reason}`);
  }
  lines.push("");
  lines.push("## Summary");
  lines.push(`- passed: ${report.summary.passed}`);
  lines.push(`- failed: ${report.summary.failed}`);
  lines.push(`- releaseReady: ${report.summary.releaseReady}`);
  return `${lines.join("\n")}\n`;
}

function writeReport(report: GuardrailReport): { jsonPath: string; mdPath: string } {
  fs.mkdirSync(report.options.outDir, { recursive: true });
  const stamp = safeStamp(report.runAt);
  const jsonPath = path.join(report.options.outDir, `guardrail-${stamp}.json`);
  const mdPath = path.join(report.options.outDir, `guardrail-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const contractContent = mustReadFile(opts.contractPath, "contract template");
  const requestContent = mustReadFile(opts.requestPath, "request template");
  const results: Result[] = [
    checkContains(contractContent, "in_scope", "边界明确（防 scope creep）"),
    checkContains(contractContent, "out_of_scope", "边界明确（防越界改动）"),
    checkContains(contractContent, "acceptance", "存在验收门禁"),
    checkContains(contractContent, "rollback", "存在回退策略"),
    checkContains(contractContent, "parallel_group", "存在并行分组"),
    checkContains(contractContent, "shared_write_lock", "存在共享写锁定义"),
    checkContains(requestContent, "验收命令", "需求模板要求验收命令"),
    checkContains(requestContent, "可并行", "需求模板要求并行边界"),
    checkContains(requestContent, "回退触发条件", "需求模板要求回退触发条件"),
  ];
  const failed = results.filter((r) => !r.passed);
  const report: GuardrailReport = {
    reportType: "multitask-guardrail",
    runAt: new Date().toISOString(),
    options: opts,
    checks: results,
    summary: {
      passed: results.length - failed.length,
      failed: failed.length,
      releaseReady: failed.length === 0,
    },
  };
  const output = writeReport(report);
  console.log("[Multitask Guardrail] results:");
  for (const item of results) {
    console.log(`- ${item.passed ? "PASS" : "FAIL"} ${item.rule}: ${item.reason}`);
  }
  console.log("[Multitask Guardrail] report written:");
  console.log(`- ${output.jsonPath}`);
  console.log(`- ${output.mdPath}`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Multitask Guardrail] failed: ${message}`);
  console.error(usage());
  process.exitCode = 1;
}
