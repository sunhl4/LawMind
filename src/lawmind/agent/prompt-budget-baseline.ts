/**
 * Shared fixture for the prompt-budget baseline (P0, 2026-10-26).
 *
 * The same four tasks and three pressure levels are consumed by:
 *   - `scripts/lawmind/lawmind-prompt-budget.ts` (the report printed into
 *     `docs/LAWMIND-PROMPT-BUDGET-BASELINE.md`);
 *   - `prompt-budget-baseline.test.ts` (the regression lock).
 *
 * Keeping one fixture is deliberate: when the script and the test each carried
 * their own copy, a change to pins or instructions would silently make the
 * published baseline describe a different turn than the one the test asserts.
 *
 * This module is **not** imported by production code.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileIntent } from "../intent/compile-intent.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import type { PromptBudgetReport } from "./prompt-budget-report.js";
import { ToolRegistry } from "./tools/registry.js";
import { prepareTurnPromptContext } from "./turn-orchestrator-prompt.js";
import type { AgentConfig, AgentSession } from "./types.js";

export type PromptBudgetBaselineTask = {
  id: string;
  instruction: string;
  pins: ComposeContextPin[];
  /** Request-body markers that must remain after packing. */
  requiredMarkers: string[];
};

export type PromptBudgetBaselineScenario = {
  id: "default" | "large" | "max_pins";
  label: string;
  contextTokens: number;
  useMaxPins: boolean;
};

export type PromptBudgetObservation = {
  task: PromptBudgetBaselineTask;
  scenario: PromptBudgetBaselineScenario;
  report: PromptBudgetReport;
  prompt: string;
  /** Pure `compileIntent` result for the same instruction + pins (evidence). */
  intent: {
    capabilityId?: string;
    source?: string;
    confidence?: string;
  };
};

export type PromptBudgetViolation = {
  scenario: string;
  task: string;
  message: string;
};

export const CONTRACT_PIN: ComposeContextPin = {
  pinKind: "file",
  root: "project",
  relPath: "采购合同.docx",
  kind: "file",
};

export const REDLINE_PIN: ComposeContextPin = {
  pinKind: "file",
  root: "workspace",
  relPath: "设备采购合同.docx",
  kind: "file",
};

export const PROMPT_BUDGET_BASELINE_TASKS: readonly PromptBudgetBaselineTask[] = [
  {
    id: "contract.review",
    instruction: "请审查这份采购合同的违约责任与付款条款",
    pins: [CONTRACT_PIN],
    requiredMarkers: ["## 检索协议"],
  },
  {
    id: "research.memo",
    instruction: "就股权回购条款的效力做一份检索备忘录，列出支持与反对的裁判观点",
    pins: [],
    requiredMarkers: ["## 检索协议"],
  },
  {
    id: "litigation.draft",
    // Dispatched capability path: the lawyer picked 诉讼文书 in the desk, which is
    // how this capability reaches the hard-bind branch that injects Skill bodies.
    instruction: [
      "【办件】能力：litigation.draft",
      "根据以下事实写一份民事起诉状：原告甲，被告乙，请求判令返还借款本金50万元及利息。",
    ].join("\n"),
    pins: [],
    requiredMarkers: ["线性栏目", "起诉状"],
  },
  {
    id: "word.redline",
    instruction: "修改合同，导出带修订 Word",
    pins: [REDLINE_PIN],
    requiredMarkers: ["## 改稿计划", "## 检索协议"],
  },
];

export const PROMPT_BUDGET_BASELINE_SCENARIOS: readonly PromptBudgetBaselineScenario[] = [
  { id: "default", label: "默认窗口 128k", contextTokens: 128_000, useMaxPins: false },
  { id: "large", label: "较大窗口 512k", contextTokens: 512_000, useMaxPins: false },
  { id: "max_pins", label: "最多钉选材料", contextTokens: 128_000, useMaxPins: true },
];

/**
 * Maximum pinned material *for that task*. A contract review on a deal room
 * pins contract versions, not unrelated PDFs; a research memo pins articles.
 * Keeping the attachment genre aligned measures the budget instead of the
 * intent compiler's dominant-genre rule (that case is covered separately).
 */
export function maxPinsFor(taskId: string): ComposeContextPin[] {
  if (taskId === "contract.review" || taskId === "word.redline") {
    return [
      CONTRACT_PIN,
      REDLINE_PIN,
      ...Array.from({ length: 10 }, (_, index) => ({
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: `materials/补充协议-${String(index + 1).padStart(2, "0")}.docx`,
        kind: "file" as const,
      })),
      { pinKind: "theory", matterId: "m-baseline" },
    ];
  }
  if (taskId === "litigation.draft") {
    return [
      ...Array.from({ length: 12 }, (_, index) => ({
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: `materials/证据-${String(index + 1).padStart(2, "0")}.pdf`,
        kind: "file" as const,
      })),
      { pinKind: "theory", matterId: "m-baseline" },
    ];
  }
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: `materials/论文-${String(index + 1).padStart(2, "0")}.pdf`,
      kind: "file" as const,
    })),
    { pinKind: "theory", matterId: "m-baseline" },
  ];
}

/**
 * The mixed-attachment case from the baseline narrative: two contracts plus
 * ten unrelated PDFs (unclassifiable names, no peek → genre `unknown`).
 *
 * P0 measured the defect here: `dominantGenre` became `unknown`, so the same
 * 「请审查这份采购合同」 bound as `keyword/medium` and the stage Skill body was
 * replaced by the flat catalog index. P1-a fixed it in `dominantDocumentGenre`:
 * untyped attachments no longer outvote a unanimous typed genre. The test now
 * locks the fixed shape (`joint/high`, full skill body, retrieval protocol
 * present) so the regression cannot come back silently.
 */
export function mixedGenreContractPins(): ComposeContextPin[] {
  return [
    CONTRACT_PIN,
    REDLINE_PIN,
    ...Array.from({ length: 10 }, (_, index) => ({
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: `materials/论文-${String(index + 1).padStart(2, "0")}.pdf`,
      kind: "file" as const,
    })),
    { pinKind: "theory", matterId: "m-baseline" },
  ];
}

/**
 * P1-e case: two contracts plus ten *typed but unrelated* attachments (证据清单).
 * Before P1-e the evidence pile owned `dominantGenre`, so the same sentence
 * bound `litigation.draft` / joint/high — a wrong capability, not just a
 * missing skill body. Kept next to the untyped pile because the two exercise
 * different rules (genre unanimity vs explicit-object precedence).
 */
export function typedPileContractPins(): ComposeContextPin[] {
  return [
    CONTRACT_PIN,
    REDLINE_PIN,
    ...Array.from({ length: 10 }, (_, index) => ({
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: `materials/证据清单-${String(index + 1).padStart(2, "0")}.pdf`,
      kind: "file" as const,
    })),
    { pinKind: "theory", matterId: "m-baseline" },
  ];
}

export async function seedPromptBudgetWorkspace(workspaceDir: string): Promise<void> {
  const matterId = "m-baseline";
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "cases", matterId), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "playbooks"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Global memory", "utf8");
  await fs.writeFile(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# Lawyer profile", "utf8");
  await fs.writeFile(
    path.join(workspaceDir, "cases", matterId, "CASE.md"),
    [
      "# 案",
      "",
      "## 1. 基本信息",
      "",
      "- 当事人：甲方（采购方）与乙方（供货方）",
      "- 争议：设备采购合同违约与付款节点",
      "",
      "## 2. 事实",
      "",
      "未交货部分对应价款 50 万元，逾期 30 日。",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceDir, "cases", matterId, "MATTER_STRATEGY.md"),
    "# 本案理论\n\n先主张继续履行，备位主张解除并赔偿。",
    "utf8",
  );
}

/** Push the `pins` fragment to its cap so the max-pins scenario is not cosmetic. */
export async function forceLongPins(workspaceDir: string): Promise<void> {
  await fs.writeFile(
    path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md"),
    `# 条款 Playbook\n\n${"付款与验收条款应相互勾连；违约金不得超过实际损失的百分之三十。\n".repeat(600)}`,
    "utf8",
  );
}

export async function makePromptBudgetWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-prompt-budget-"));
  await seedPromptBudgetWorkspace(workspaceDir);
  return workspaceDir;
}

function visiblePrompt(result: { systemPromptFinal: string }, session: AgentSession): string {
  return [result.systemPromptFinal, session.samplingPromptTail ?? ""].join("\n");
}

export async function observePromptBudgetTurn(opts: {
  workspaceDir: string;
  task: PromptBudgetBaselineTask;
  contextTokens: number;
  pins: ComposeContextPin[];
  sessionId: string;
}): Promise<{
  report: PromptBudgetReport;
  prompt: string;
  intent: PromptBudgetObservation["intent"];
}> {
  const session: AgentSession = {
    sessionId: opts.sessionId,
    actorId: "system",
    matterId: "m-baseline",
    turns: [],
    conversationHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const config: AgentConfig = {
    workspaceDir: opts.workspaceDir,
    model: {
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:1",
      apiKey: "test",
      model: "gpt-4o-mini",
      contextTokens: opts.contextTokens,
    },
  };
  const result = await prepareTurnPromptContext({
    config,
    registry: new ToolRegistry(),
    session,
    instruction: opts.task.instruction,
    resolvedAssistantId: undefined,
    linkedTaskIdForCtx: undefined,
    projectDirResolved: undefined,
    contextPins: opts.pins,
  });
  const compiled = compileIntent({ instruction: opts.task.instruction, pins: opts.pins });
  return {
    report: result.promptBudget,
    prompt: visiblePrompt(result, session),
    intent: {
      ...(compiled.capabilityId ? { capabilityId: compiled.capabilityId } : {}),
      source: compiled.source,
      confidence: compiled.confidence,
    },
  };
}

export async function observePromptBudgetScenario(
  workspaceDir: string,
  task: PromptBudgetBaselineTask,
  scenario: PromptBudgetBaselineScenario,
): Promise<PromptBudgetObservation> {
  const { report, prompt, intent } = await observePromptBudgetTurn({
    workspaceDir,
    task,
    contextTokens: scenario.contextTokens,
    pins: scenario.useMaxPins ? maxPinsFor(task.id) : task.pins,
    sessionId: `sess-${task.id}-${scenario.id}`,
  });
  return { task, scenario, report, prompt, intent };
}

/**
 * Binding witness for the same sentence under three material mixes. Only the
 * pinned attachments differ, so all three must bind `contract.review` at
 * `joint/high` with a full skill body and the retrieval protocol:
 *   1. one contract (clean baseline);
 *   2. two contracts + ten untyped PDFs — P1-a (genre unanimity);
 *   3. two contracts + ten 证据清单 — P1-e (explicit object outranks genre).
 */
export type ContractBindingWitness = {
  baseline: PromptBudgetObservation;
  untypedPile: PromptBudgetObservation;
  typedPile: PromptBudgetObservation;
};

export async function observeContractBindingWitness(
  workspaceDir: string,
): Promise<ContractBindingWitness> {
  const task = PROMPT_BUDGET_BASELINE_TASKS.find((item) => item.id === "contract.review")!;
  const scenario = PROMPT_BUDGET_BASELINE_SCENARIOS[0];
  const baseline = await observePromptBudgetScenario(workspaceDir, task, scenario);
  const untyped = await observePromptBudgetTurn({
    workspaceDir,
    task,
    contextTokens: scenario.contextTokens,
    pins: mixedGenreContractPins(),
    sessionId: "sess-contract.review-untyped-pile",
  });
  const typed = await observePromptBudgetTurn({
    workspaceDir,
    task,
    contextTokens: scenario.contextTokens,
    pins: typedPileContractPins(),
    sessionId: "sess-contract.review-typed-pile",
  });
  return {
    baseline,
    untypedPile: { task, scenario, ...untyped },
    typedPile: { task, scenario, ...typed },
  };
}

function skillFragments(report: PromptBudgetReport) {
  return report.fragments.filter((fragment) => fragment.kind === "skill_index");
}

function keptSkillTokens(report: PromptBudgetReport): number {
  return skillFragments(report)
    .filter((fragment) => fragment.kept)
    .reduce((sum, fragment) => sum + fragment.tokens, 0);
}

/**
 * P1-a / P1-e acceptance: extra attachments must not weaken an explicit
 * 「审查合同」turn. The three observations use the same instruction; only the
 * pinned material differs, so `joint/high` + a full skill body + the retrieval
 * protocol must survive all of them. Returns one entry per violation.
 */
export function checkMixedGenreBinding(binding: ContractBindingWitness): PromptBudgetViolation[] {
  const violations: PromptBudgetViolation[] = [];
  const key = "contract.review · mixed_genre";
  const push = (message: string) =>
    violations.push({
      scenario: "mixed_genre",
      task: "contract.review",
      message: `${key}: ${message}`,
    });

  for (const [label, observation] of [
    ["只钉一份合同", binding.baseline],
    ["2 份合同 + 10 份无关 PDF", binding.untypedPile],
    ["2 份合同 + 10 份证据清单", binding.typedPile],
  ] as const) {
    if (observation.intent.capabilityId !== "contract.review") {
      push(`${label} 绑成了 ${observation.intent.capabilityId ?? "未绑定"}`);
    }
    if (observation.intent.source !== "joint") {
      push(`${label} 的 source 是 ${observation.intent.source ?? "—"}，应为 joint`);
    }
    if (observation.intent.confidence !== "high") {
      push(`${label} 的 confidence 是 ${observation.intent.confidence ?? "—"}，应为 high`);
    }
    if (keptSkillTokens(observation.report) < 2_000) {
      push(
        `${label} 只注入了 ${keptSkillTokens(observation.report)} token 的技能（疑为目录索引），应 ≥ 2000`,
      );
    }
    if (!observation.prompt.includes("## 检索协议")) {
      push(`${label} 的请求体缺少「## 检索协议」`);
    }
  }
  return violations;
}

/**
 * P0 acceptance checks. Returns one entry per violation; empty means pass.
 * Only request-body facts and the packer's own report are used — no model
 * scoring, no assertion that a specific Chinese sentence survives.
 */
export function checkPromptBudgetObservation(
  observation: PromptBudgetObservation,
): PromptBudgetViolation[] {
  const { task, scenario, report, prompt } = observation;
  const violations: PromptBudgetViolation[] = [];
  const key = `${task.id} · ${scenario.id}`;

  const skills = skillFragments(report);
  if (skills.length === 0) {
    violations.push({ scenario: scenario.id, task: task.id, message: `${key}: 没有 skill_index` });
  }
  for (const skill of skills) {
    if (!skill.kept) {
      violations.push({
        scenario: scenario.id,
        task: task.id,
        message: `${key}: Skill 片段被丢弃（${skill.label}）`,
      });
    }
    if (skill.truncated) {
      violations.push({
        scenario: scenario.id,
        task: task.id,
        message: `${key}: Skill 正文被截断（${skill.label}）`,
      });
    }
  }
  if (prompt.includes("…[截断，完整内容请用 read_skill")) {
    violations.push({
      scenario: scenario.id,
      task: task.id,
      message: `${key}: 请求体里出现 read_skill 截断指针`,
    });
  }
  for (const marker of task.requiredMarkers) {
    if (!prompt.includes(marker)) {
      violations.push({
        scenario: scenario.id,
        task: task.id,
        message: `${key}: 缺少关键协议「${marker}」`,
      });
    }
  }
  for (const fragment of report.fragments) {
    if (fragment.kind === "protocol" && fragment.dropReason === "budget") {
      violations.push({
        scenario: scenario.id,
        task: task.id,
        message: `${key}: 协议被丢弃「${fragment.label}」`,
      });
    }
    if (fragment.kind === "pins" && fragment.truncated && !prompt.includes("…[截断")) {
      violations.push({
        scenario: scenario.id,
        task: task.id,
        message: `${key}: 钉选内容截断却没有溢出指针`,
      });
    }
  }
  if (report.fragmentCount !== report.keptCount + report.droppedCount + report.collapsedCount) {
    violations.push({
      scenario: scenario.id,
      task: task.id,
      message: `${key}: 片段计数不自洽（${report.fragmentCount} ≠ ${report.keptCount}+${report.droppedCount}+${report.collapsedCount}）`,
    });
  }
  return violations;
}
