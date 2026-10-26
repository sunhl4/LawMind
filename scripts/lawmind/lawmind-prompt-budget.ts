/**
 * Prompt-budget baseline (P0, 2026-10-26).
 *
 * Assembles the real turn prompt for four fixed tasks across three pressure
 * levels and prints every fragment with its token estimate and keep/drop
 * decision. The fixture is shared with `prompt-budget-baseline.test.ts` so the
 * published baseline cannot drift from the regression lock.
 *
 * Usage:
 *   pnpm lawmind:prompt-budget              # Markdown report
 *   pnpm --silent lawmind:prompt-budget -- --json   # machine-readable (--silent keeps pnpm's banner out of stdout)
 *
 * Exit code is non-zero when a scenario violates the P0 contract:
 *   - a Skill body is truncated mid-sentence;
 *   - a required protocol marker is missing from the request body;
 *   - a protocol fragment was dropped by the packer;
 *   - the report's kept/dropped/deduped counts do not add up.
 *
 * The binding appendix is the P1-a / P1-e regression witness: the same
 * 「审查合同」sentence with one contract, with two contracts plus ten unrelated
 * PDFs, and with two contracts plus ten 证据清单 must bind identically
 * (`contract.review` at `joint/high`, full skill body, retrieval protocol
 * present). A degraded row also fails this command, so the table cannot
 * quietly turn back to keyword/medium or to another capability.
 */

import fs from "node:fs/promises";
import {
  checkMixedGenreBinding,
  checkPromptBudgetObservation,
  forceLongPins,
  makePromptBudgetWorkspace,
  observeContractBindingWitness,
  observePromptBudgetScenario,
  PROMPT_BUDGET_BASELINE_SCENARIOS,
  PROMPT_BUDGET_BASELINE_TASKS,
  type ContractBindingWitness,
  type PromptBudgetObservation,
  type PromptBudgetViolation,
} from "../../src/lawmind/agent/prompt-budget-baseline.js";
import { formatPromptBudgetReport } from "../../src/lawmind/agent/prompt-budget-report.js";

function toJson(
  observations: PromptBudgetObservation[],
  violations: PromptBudgetViolation[],
  binding: ContractBindingWitness,
): string {
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      baseline: "lawmind-prompt-budget-2026-10-26",
      violations,
      observations: observations.map(({ task, scenario, report, intent }) => ({
        task: task.id,
        scenario: scenario.id,
        requiredMarkers: task.requiredMarkers,
        intent,
        report,
      })),
      binding: {
        baseline: binding.baseline.report,
        untypedPile: binding.untypedPile.report,
        typedPile: binding.typedPile.report,
        baselineIntent: binding.baseline.intent,
        untypedPileIntent: binding.untypedPile.intent,
        typedPileIntent: binding.typedPile.intent,
      },
    },
    null,
    2,
  );
}

function toMarkdown(
  observations: PromptBudgetObservation[],
  violations: PromptBudgetViolation[],
  binding: ContractBindingWitness,
): string {
  const lines: string[] = [
    "## 生成明细",
    "",
    "由 `pnpm lawmind:prompt-budget` 生成：四个固定任务 × 三个压力档位，",
    "全部经由真实 `prepareTurnPromptContext` 装配；每个片段记录",
    "kind、优先级、token、保留/丢弃/去重与截断状态。",
    "",
    "> 口径：CJK 约 1 字 ≈ 1 token（`estimateTextTokens`）。打包器软预算默认 12,000，",
    "> 512k 窗口按 4× 放大到 48,000。Skill 正文不得按字符切半；关键协议不得静默消失；",
    "> 重复的会话 `craft` 片段是「去重」而非预算丢弃，不计入丢弃数。",
    "",
    "## 汇总",
    "",
    "| 任务 | 场景 | 打包预算 | 片段 | 丢弃 | 去重 | Skill | Protocol | Pins | 其它 | 截断 |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const { task, scenario, report } of observations) {
    const kindTokens = (kind: string) =>
      report.fragments
        .filter((fragment) => fragment.kept && fragment.kind === kind)
        .reduce((sum, fragment) => sum + fragment.tokens, 0);
    const skillTokens = kindTokens("skill_index");
    const protocolTokens = kindTokens("protocol");
    const pinTokens = kindTokens("pins");
    const otherTokens = Math.max(0, report.keptTokens - skillTokens - protocolTokens - pinTokens);
    lines.push(
      `| ${task.id} | ${scenario.label} | ${report.keptTokens}/${report.budgetTokens} | ` +
        `${report.keptCount}/${report.fragmentCount} | ${report.droppedCount} | ` +
        `${report.collapsedCount} | ${skillTokens} | ${protocolTokens} | ${pinTokens} | ` +
        `${otherTokens} | ${report.truncatedKinds.join(",") || "—"} |`,
    );
  }
  lines.push(
    "",
    "## 合同绑定回归（P1-a / P1-e）",
    "",
    "同一句「请审查这份采购合同的违约责任与付款条款」，只改变钉选材料：",
    "",
    "| 场景 | 绑定 | Skill token | 检索协议 | 片段 |",
    "| --- | --- | ---: | --- | ---: |",
  );
  for (const [label, observation] of [
    ["只钉 1 份采购合同", binding.baseline],
    ["2 份合同 + 10 份无关 PDF", binding.untypedPile],
    ["2 份合同 + 10 份证据清单", binding.typedPile],
  ] as const) {
    const skillTokens = observation.report.fragments
      .filter((fragment) => fragment.kept && fragment.kind === "skill_index")
      .reduce((sum, fragment) => sum + fragment.tokens, 0);
    lines.push(
      `| ${label} | ${observation.intent.source ?? "—"}/${observation.intent.confidence ?? "—"} | ` +
        `${skillTokens} | ${observation.prompt.includes("## 检索协议") ? "有" : "无"} | ` +
        `${observation.report.keptCount}/${observation.report.fragmentCount} |`,
    );
  }
  lines.push(
    "",
    "P1-a / P1-e 之后三行必须一致：附件只增加钉选片段，不把本阶段技能正文换成目录，不丢检索协议，也不把绑定改成别的能力。",
    "命令在任一行退化（source 不是 joint / confidence 不是 high / 技能 < 2000 token / 缺检索协议）时以非零退出。",
  );
  lines.push("", "## 检查结果", "");
  if (violations.length === 0) {
    lines.push(
      "全部场景通过：没有半篇 Skill、没有关键协议缺失、没有静默丢弃；混合附件绑定与干净回合一致。",
    );
  } else {
    for (const violation of violations) {
      lines.push(`- ❌ ${violation.message}`);
    }
  }
  lines.push("", "## 完整片段清单", "");
  for (const { task, scenario, report } of observations) {
    lines.push(`### ${task.id} · ${scenario.label}`, "", "```text");
    lines.push(formatPromptBudgetReport(report));
    lines.push("```", "");
  }
  return lines.join("\n");
}

async function observeBinding(): Promise<ContractBindingWitness> {
  // A fresh workspace so the max-pins clause playbook cannot influence the
  // "only one contract" baseline used for comparison.
  const workspaceDir = await makePromptBudgetWorkspace();
  try {
    return await observeContractBindingWitness(workspaceDir);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const json = process.argv.includes("--json");
  const workspaceDir = await makePromptBudgetWorkspace();
  try {
    const observations: PromptBudgetObservation[] = [];
    for (const scenario of PROMPT_BUDGET_BASELINE_SCENARIOS) {
      if (scenario.useMaxPins) {
        await forceLongPins(workspaceDir);
      }
      for (const task of PROMPT_BUDGET_BASELINE_TASKS) {
        observations.push(await observePromptBudgetScenario(workspaceDir, task, scenario));
      }
    }
    const binding = await observeBinding();
    const violations = [
      ...observations.flatMap(checkPromptBudgetObservation),
      ...checkMixedGenreBinding(binding),
    ];
    process.stdout.write(
      `${json ? toJson(observations, violations, binding) : toMarkdown(observations, violations, binding)}\n`,
    );
    if (violations.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
