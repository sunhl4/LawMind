import fs from "node:fs";
import path from "node:path";

type ItemStatus = "已满足" | "部分满足" | "未满足";

type AuditItem = {
  id: string;
  title: string;
  status: ItemStatus;
  evidence: string[];
  gap: string;
  action: string;
  acceptance: string[];
};

type AuditReport = {
  reportType: "multitask-audit-matrix";
  runAt: string;
  strict: boolean;
  items: AuditItem[];
  summary: {
    satisfied: number;
    partial: number;
    unmet: number;
    releaseReady: boolean;
  };
};

function parseArgs(argv: string[]): { strict: boolean; outDir: string } {
  let strict = false;
  let outDir = path.join(process.cwd(), "dist", "lawmind", "multitask-validation");
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--") {
      continue;
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--out-dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("missing value for --out-dir");
      }
      outDir = path.resolve(process.cwd(), value);
      i += 1;
      continue;
    }
    if (token === "--help") {
      console.log(
        "Usage: node --import tsx scripts/lawmind/lawmind-multitask-audit.ts [--strict] [--out-dir <path>]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${token}`);
  }
  return { strict, outDir };
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

function read(rel: string): string {
  const full = path.join(process.cwd(), rel);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function hasAll(content: string, tokens: string[]): boolean {
  return tokens.every((token) => content.includes(token));
}

function evaluateItems(): AuditItem[] {
  const playbook = read("docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md");
  const baseline = read("docs/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION.md");
  const contract = read("docs/lawmind/templates/task-contract-v1.md");
  const validateScript = read("scripts/lawmind/lawmind-multitask-validate.ts");
  const packageJson = read("package.json");

  const items: AuditItem[] = [
    {
      id: "1",
      title: "定义与边界",
      status:
        hasAll(playbook, ["背景与适用范围", "并行与串行边界"]) &&
        hasAll(contract, ["in_scope", "out_of_scope"])
          ? "已满足"
          : "部分满足",
      evidence: [
        "docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md",
        "docs/lawmind/templates/task-contract-v1.md",
      ],
      gap: "边界存在但需要持续通过模板执行。",
      action: "保留 task contract 必填项并纳入 guardrail 检查。",
      acceptance: ["pnpm lawmind:multitask:guardrail"],
    },
    {
      id: "2",
      title: "核心理念（并行/异步/隔离/C-W/吞吐-延迟-准确率）",
      status:
        hasAll(playbook, ["Coordinator", "Worker", "异步长任务"]) &&
        exists("scripts/lawmind/lawmind-multitask-observability.ts")
          ? "已满足"
          : "部分满足",
      evidence: [
        "docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md",
        "scripts/lawmind/lawmind-multitask-observability.ts",
      ],
      gap: "吞吐-延迟-准确率需要持续采样。",
      action: "使用 observability 报告固定输出 lead time/retry/first-pass。",
      acceptance: ["pnpm lawmind:multitask:observability -- --window-days 14"],
    },
    {
      id: "3",
      title: "运行机制（生命周期/worker/冲突/异步/重试回退）",
      status:
        hasAll(playbook, ["冲突治理与回退策略", "回退触发条件"]) &&
        hasAll(validateScript, ["functional-workflow-tests", "ui-http-smoke"])
          ? "已满足"
          : "部分满足",
      evidence: [
        "docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md",
        "scripts/lawmind/lawmind-multitask-validate.ts",
        "docs/LAWMIND-ARCHITECTURE.md",
      ],
      gap: "单/多 worker 规则仍依赖契约执行。",
      action: "以 parallel_group + shared_write_lock 作为 worker 规则门禁。",
      acceptance: ["pnpm lawmind:multitask:guardrail", "pnpm lawmind:multitask:validate:strict"],
    },
    {
      id: "4",
      title: "目的与价值",
      status:
        hasAll(playbook, ["目标", "可验收"]) && hasAll(read("GOALS.md"), ["任务级可验收交付"])
          ? "已满足"
          : "部分满足",
      evidence: ["docs/lawmind/LAWMIND-MULTITASK-PLAYBOOK.md", "GOALS.md"],
      gap: "价值口径需与版本发布门禁保持一致。",
      action: "以 releaseReady 作为可发布信号。",
      acceptance: ["pnpm lawmind:multitask:validate"],
    },
    {
      id: "5",
      title: "时间维度可观测",
      status: exists("scripts/lawmind/lawmind-multitask-observability.ts") ? "已满足" : "未满足",
      evidence: [
        "scripts/lawmind/lawmind-multitask-observability.ts",
        "dist/lawmind/multitask-validation/observability-*.json",
      ],
      gap: "需要持续沉淀真实窗口数据。",
      action: "每次验证后生成 observability 报告并归档。",
      acceptance: ["pnpm lawmind:multitask:observability -- --window-days 14"],
    },
    {
      id: "6",
      title: "端到端示例可复用",
      status:
        hasAll(baseline, ["可执行命令", "严格校验"]) &&
        hasAll(validateScript, ["definitionOfDone", "releaseReady"]) &&
        exists("docs/lawmind/LAWMIND-MULTITASK-CHECK-MATRIX.md")
          ? "已满足"
          : "部分满足",
      evidence: [
        "docs/lawmind/LAWMIND-MULTITASK-BASELINE-VALIDATION.md",
        "docs/lawmind/LAWMIND-MULTITASK-CHECK-MATRIX.md",
        "scripts/lawmind/lawmind-multitask-validate.ts",
      ],
      gap: "需保持 baseline、核查矩阵与 validate 脚本一致，并在每轮归档 report。",
      action: "固定归档 report-*.json|md，并维护 CHECK-MATRIX 与命令入口同步。",
      acceptance: ["pnpm lawmind:multitask:validate:strict"],
    },
    {
      id: "7",
      title: "用户提需求模板",
      status: exists("docs/lawmind/templates/multitask-request-template.md") ? "已满足" : "未满足",
      evidence: [
        "docs/lawmind/templates/multitask-request-template.md",
        "docs/lawmind/templates/task-contract-v1.md",
      ],
      gap: "模板需在新任务中被强制引用。",
      action: "需求单必须带 contract/acceptance/rollback/parallel 四块。",
      acceptance: ["pnpm lawmind:multitask:guardrail"],
    },
    {
      id: "8",
      title: "常见误区防护",
      status: exists("scripts/lawmind/lawmind-multitask-guardrail-check.ts") ? "已满足" : "未满足",
      evidence: [
        "scripts/lawmind/lawmind-multitask-guardrail-check.ts",
        "docs/lawmind/templates/multitask-request-template.md",
      ],
      gap: "需持续纳入 CI/发布前检查。",
      action: "把 guardrail 检查接入 validate strict。",
      acceptance: ["pnpm lawmind:multitask:guardrail", "pnpm lawmind:multitask:validate:strict"],
    },
    {
      id: "9",
      title: "Task-first vs Workspace-first 决策框架",
      status:
        exists("scripts/lawmind/lawmind-multitask-decision.ts") &&
        exists("docs/lawmind/templates/task-vs-workspace-decision-sheet.md")
          ? "已满足"
          : "部分满足",
      evidence: [
        "scripts/lawmind/lawmind-multitask-decision.ts",
        "docs/lawmind/templates/task-vs-workspace-decision-sheet.md",
      ],
      gap: "需要在协作任务启动前完成一次打分。",
      action: "新任务默认执行决策脚本并附输出。",
      acceptance: [
        "pnpm lawmind:multitask:decision -- --task-complexity 4 --workspace-volatility 2",
      ],
    },
  ];

  if (!hasAll(packageJson, ["lawmind:multitask:validate:strict"])) {
    const item = items.find((it) => it.id === "6");
    if (item) {
      item.status = "未满足";
      item.gap = "缺少 strict 验证命令入口。";
      item.action = "在 package.json 补齐 validate strict 脚本。";
    }
  }
  return items;
}

function toMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push("# LawMind Multitask 对照核查报告（自动审计）");
  lines.push("");
  lines.push(`- reportType: ${report.reportType}`);
  lines.push(`- runAt: ${report.runAt}`);
  lines.push(`- strict: ${report.strict}`);
  lines.push("");
  lines.push("## 逐条核查");
  for (const item of report.items) {
    lines.push(`### ${item.id}) ${item.title}`);
    lines.push(`- 状态：${item.status}`);
    lines.push(`- 证据：${item.evidence.map((ev) => `\`${ev}\``).join("；")}`);
    lines.push(`- 补齐动作：${item.action}`);
    lines.push(`- 验收命令：${item.acceptance.map((cmd) => `\`${cmd}\``).join("；")}`);
    lines.push("");
  }
  lines.push("## Summary");
  lines.push(`- satisfied: ${report.summary.satisfied}`);
  lines.push(`- partial: ${report.summary.partial}`);
  lines.push(`- unmet: ${report.summary.unmet}`);
  lines.push(`- releaseReady: ${report.summary.releaseReady}`);
  return `${lines.join("\n")}\n`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const items = evaluateItems();
  const summary = {
    satisfied: items.filter((item) => item.status === "已满足").length,
    partial: items.filter((item) => item.status === "部分满足").length,
    unmet: items.filter((item) => item.status === "未满足").length,
    releaseReady: items.every((item) => item.status === "已满足"),
  };
  const report: AuditReport = {
    reportType: "multitask-audit-matrix",
    runAt: new Date().toISOString(),
    strict: opts.strict,
    items,
    summary,
  };
  fs.mkdirSync(opts.outDir, { recursive: true });
  const stamp = report.runAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(opts.outDir, `audit-matrix-${stamp}.json`);
  const mdPath = path.join(opts.outDir, `audit-matrix-${stamp}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");
  console.log("[Multitask Audit] report written:");
  console.log(`- ${jsonPath}`);
  console.log(`- ${mdPath}`);

  const strictFailed = report.items.filter((item) => item.status !== "已满足");
  if (opts.strict && strictFailed.length > 0) {
    console.error(
      `[Multitask Audit] strict mode failed: ${strictFailed.length} items are not 已满足`,
    );
    for (const item of strictFailed) {
      console.error(`- ${item.id}) ${item.title}: ${item.status}`);
    }
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Multitask Audit] failed: ${message}`);
  process.exitCode = 1;
}
