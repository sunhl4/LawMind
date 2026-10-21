#!/usr/bin/env node
/**
 * 三条任务链在**本机真实材料**上的离线探针（不调模型、不花钱）。
 *
 *   pnpm lawmind:task-chains                        # 默认 workspace/，自动挑材料最多的案件
 *   pnpm lawmind:task-chains -- --matter xinghui-sale-876
 *   pnpm lawmind:task-chains -- --workspace /path/to/ws --json
 *   pnpm lawmind:task-chains -- --out lawmind/metrics/task-chains.md
 *
 * 回答的是「产物能不能打开、关键事实对不对、修订有没有丢、原件有没有被改写」。
 * 需要模型的那条链（正文成稿）会明确 SKIP，不拿假模型冒充。
 */

import fs from "node:fs";
import path from "node:path";
import {
  listProbeMatters,
  probeContractExtractionChain,
  probeDraftChainWithoutModel,
  probeWordRevisionChain,
  type ProbeReport,
} from "../../src/lawmind/evaluation/task-chain-probe.js";

const USAGE = [
  "用法: pnpm lawmind:task-chains -- [--workspace <dir>] [--matter <id>] [--json] [--out <file>]",
].join("\n");

function valueOf(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} 缺少值\n${USAGE}`);
    process.exit(2);
  }
  return value;
}

function renderMarkdown(
  reports: ProbeReport[],
  meta: { workspaceDir: string; matterId: string },
): string {
  const lines = [
    "# 任务链离线探针",
    "",
    `- 工作区：${meta.workspaceDir}`,
    `- 案件：${meta.matterId}`,
    `- 时间：${new Date().toISOString()}`,
    "",
  ];
  for (const report of reports) {
    lines.push(`## ${report.chain} · ${report.status}`, "");
    lines.push("| 步骤 | 结果 | 说明 | 耗时 |", "| --- | --- | --- | --- |");
    for (const step of report.steps) {
      lines.push(
        `| ${step.step} | ${step.status} | ${(step.detail ?? "").replace(/\|/g, "\\|")} | ${step.ms === undefined ? "" : `${step.ms}ms`} |`,
      );
    }
    const facts = Object.entries(report.facts);
    if (facts.length > 0) {
      lines.push("", "关键事实：");
      for (const [key, value] of facts) {
        lines.push(`- ${key}：${String(value)}`);
      }
    }
    lines.push("");
  }
  lines.push("> 这是离线探针，不是法律质量评测；没有真实模型回合就不声称「成稿已验收」。", "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const workspaceDir = path.resolve(valueOf("--workspace") ?? "workspace");
  if (!fs.existsSync(workspaceDir)) {
    console.error(`工作区不存在：${workspaceDir}\n${USAGE}`);
    process.exit(2);
  }
  const matters = listProbeMatters(workspaceDir);
  const requested = valueOf("--matter");
  const matterId = requested ?? matters.find((row) => row.materials > 0)?.matterId;
  if (!matterId) {
    const skipped = {
      ok: true,
      skipped: "no_matter_materials",
      note: "workspace/cases 下没有带材料的案件；探针不编造材料。",
      matters,
    };
    const out = valueOf("--out");
    const body = JSON.stringify(skipped, null, 2);
    if (out) {
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(path.resolve(out), `${body}\n`, "utf8");
    }
    console.log(body);
    return;
  }

  const reports: ProbeReport[] = [
    await probeWordRevisionChain({ workspaceDir, matterId }),
    await probeContractExtractionChain({ workspaceDir, matterId }),
    probeDraftChainWithoutModel(),
  ];

  const payload = {
    ok: reports.every((report) => report.status !== "failed"),
    workspaceDir,
    matterId,
    materials: matters.find((row) => row.matterId === matterId)?.materials ?? 0,
    reports,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(renderMarkdown(reports, { workspaceDir, matterId }));
  }

  const out = valueOf("--out");
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(
      path.resolve(out),
      renderMarkdown(reports, { workspaceDir, matterId }),
      "utf8",
    );
  }
  process.exit(payload.ok ? 0 : 1);
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
