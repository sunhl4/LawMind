/**
 * Baseline observation for the 2026-10-26 prompt-budget plan (P0).
 *
 * Four fixed tasks × three windows/pin pressures, assembled through the real
 * `prepareTurnPromptContext` (production gates, capability binding, packer).
 * The fixture is shared with `scripts/lawmind/lawmind-prompt-budget.ts`, so the
 * published table and these assertions describe the same turns.
 *
 * What this locks:
 *   - every fragment's token estimate and keep/drop/dedupe decision is reported;
 *   - a skill body is never truncated mid-sentence (no `read_skill` pointer);
 *   - the stage skill is actually injected, not downgraded to an index;
 *   - the key protocol for each task survives packing in every scenario.
 *
 * It does **not** score a model, and it does not assert that some Chinese
 * sentence still exists in the static system prompt — only request-body facts.
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { productMetricsPath } from "../metrics/product-metrics.js";
import {
  checkMixedGenreBinding,
  checkPromptBudgetObservation,
  forceLongPins,
  makePromptBudgetWorkspace,
  observeContractBindingWitness,
  observePromptBudgetScenario,
  PROMPT_BUDGET_BASELINE_SCENARIOS,
  PROMPT_BUDGET_BASELINE_TASKS,
  type PromptBudgetObservation,
} from "./prompt-budget-baseline.js";
import {
  buildPromptBudgetReport,
  recordPromptBudgetEvent,
  type PromptBudgetReport,
} from "./prompt-budget-report.js";
import { createPromptFragment, packPromptFragments } from "./prompt-fragments.js";

/**
 * Minimum stage-skill body per task. These are not exact watermarks (skill
 * docs may be edited); they are floors that fail if the body collapses back
 * to index-only (P0 measured ~982 tokens for the flat catalog index on every
 * task, so a per-task floor is the simplest durable discriminator).
 */
const MIN_SKILL_TOKENS: Record<string, number> = {
  "contract.review": 2_000,
  "research.memo": 1_000,
  "litigation.draft": 1_400,
  "word.redline": 1_800,
};

function skillFragments(report: PromptBudgetReport) {
  return report.fragments.filter((fragment) => fragment.kind === "skill_index");
}

function skillTokens(report: PromptBudgetReport): number {
  return skillFragments(report)
    .filter((fragment) => fragment.kept)
    .reduce((sum, fragment) => sum + fragment.tokens, 0);
}

function protocolFragments(report: PromptBudgetReport) {
  return report.fragments.filter((fragment) => fragment.kind === "protocol");
}

function budgetDroppedProtocols(report: PromptBudgetReport) {
  return protocolFragments(report).filter((fragment) => fragment.dropReason === "budget");
}

function expectCountsAddUp(report: PromptBudgetReport, label: string): void {
  expect(
    report.keptCount + report.droppedCount + report.collapsedCount,
    `${label} kept+dropped+collapsed`,
  ).toBe(report.fragmentCount);
  expect(
    report.keptTokens + report.droppedTokens + report.collapsedTokens,
    `${label} token accounting`,
  ).toBe(report.totalTokens);
}

function assertHealthyScenario(observation: PromptBudgetObservation): void {
  const { task, report, prompt } = observation;
  const label = `${task.id} · ${observation.scenario.id}`;
  expect(report.fragmentCount, label).toBeGreaterThan(0);
  expect(report.keptCount, label).toBeGreaterThan(0);
  expectCountsAddUp(report, label);

  const skills = skillFragments(report);
  expect(skills.length, `${label} has a skill fragment`).toBeGreaterThan(0);
  for (const skill of skills) {
    expect(skill.kept, `${label} skill kept`).toBe(true);
    expect(skill.truncated, `${label} skill must not be half-injected`).toBe(false);
  }
  expect(
    skillTokens(report),
    `${label} injects the stage skill body, not index-only`,
  ).toBeGreaterThanOrEqual(MIN_SKILL_TOKENS[task.id]);
  expect(prompt, label).not.toContain("…[截断，完整内容请用 read_skill");

  expect(protocolFragments(report).length, `${label} queues protocols`).toBeGreaterThan(0);
  expect(budgetDroppedProtocols(report), `${label} protocol dropped`).toEqual([]);
  for (const marker of task.requiredMarkers) {
    expect(prompt, `${label} must keep ${marker}`).toContain(marker);
  }
}

describe("prompt budget baseline (P0)", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await makePromptBudgetWorkspace();
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("keeps stage skills whole and protocols present on the default window", async () => {
    const scenario = PROMPT_BUDGET_BASELINE_SCENARIOS.find((item) => item.id === "default")!;
    for (const task of PROMPT_BUDGET_BASELINE_TASKS) {
      const observation = await observePromptBudgetScenario(workspaceDir, task, scenario);
      expect(observation.report.budgetTokens, task.id).toBe(12_000);
      assertHealthyScenario(observation);
    }
  });

  it("keeps stage skills whole and protocols present on a larger window", async () => {
    const scenario = PROMPT_BUDGET_BASELINE_SCENARIOS.find((item) => item.id === "large")!;
    for (const task of PROMPT_BUDGET_BASELINE_TASKS) {
      const observation = await observePromptBudgetScenario(workspaceDir, task, scenario);
      expect(observation.report.windowScale, task.id).toBe(4);
      expect(observation.report.budgetTokens, task.id).toBe(48_000);
      assertHealthyScenario(observation);
    }
  });

  it("keeps stage skills whole under maximum pinned material", async () => {
    // Force the `pins` fragment to its cap: a long clause playbook plus theory
    // and twelve file pins is the upper bound the plan described.
    await forceLongPins(workspaceDir);
    const scenario = PROMPT_BUDGET_BASELINE_SCENARIOS.find((item) => item.id === "max_pins")!;
    for (const task of PROMPT_BUDGET_BASELINE_TASKS) {
      const observation = await observePromptBudgetScenario(workspaceDir, task, scenario);
      const { report, prompt } = observation;
      assertHealthyScenario(observation);

      // Pins may legitimately hit their own cap (with an overflow pointer);
      // skills may not be cut in half.
      for (const pin of report.fragments.filter((fragment) => fragment.kind === "pins")) {
        if (pin.truncated) {
          expect(prompt, `${task.id} pins overflow pointer`).toMatch(/…\[截断[，,]/);
        }
      }
    }
  });

  it("binds the same deal-room instruction identically under extra attachments (P1-a / P1-e)", async () => {
    const binding = await observeContractBindingWitness(workspaceDir);
    const { baseline, untypedPile, typedPile } = binding;

    expect(checkMixedGenreBinding(binding)).toEqual([]);

    // One contract + an explicit review instruction: the stage skill body and
    // the retrieval protocol reach the request.
    expect(baseline.intent.capabilityId).toBe("contract.review");
    expect(baseline.intent.source).toBe("joint");
    expect(skillTokens(baseline.report)).toBeGreaterThanOrEqual(2_000);
    expect(baseline.prompt).toContain("## 检索协议");

    for (const [label, observation] of [
      ["untyped pile", untypedPile],
      ["typed pile", typedPile],
    ] as const) {
      expect(observation.intent.capabilityId, label).toBe("contract.review");
      expect(observation.intent.source, label).toBe("joint");
      expect(observation.intent.confidence, label).toBe("high");
      expect(skillTokens(observation.report), label).toBeGreaterThanOrEqual(2_000);
      expect(observation.prompt, label).toContain("## 检索协议");
      expect(budgetDroppedProtocols(observation.report), label).toEqual([]);
      // Extra pins are paid for by the `pins` fragment (capped, with a visible
      // pointer), never by dropping a skill or a protocol.
      expect(observation.report.droppedCount, label).toBe(0);
      expect(observation.report.truncatedKinds, label).not.toContain("skill_index");
    }
  });

  it("would fail the mixed-attachment check if the binding degraded again", () => {
    // Guard the guard: the P1-a checker must actually notice a keyword/medium
    // turn that only injected the catalog index and no retrieval protocol,
    // otherwise the regression would be silent.
    const task = PROMPT_BUDGET_BASELINE_TASKS.find((item) => item.id === "contract.review")!;
    const scenario = PROMPT_BUDGET_BASELINE_SCENARIOS[0];
    const observation = (opts: {
      source: string;
      confidence: string;
      skillChars: number;
      prompt: string;
    }): PromptBudgetObservation => {
      const fragments = [
        createPromptFragment({
          kind: "skill_index",
          body: `# 本轮 LawMind 能力：合同审查\n\n${"审".repeat(opts.skillChars)}`,
          // Bypass the per-kind cap so the fixture can hold a full-size body.
          capTokens: opts.skillChars + 1_000,
        })!,
        createPromptFragment({ kind: "protocol", body: "## 检索协议\n\n先查现行有效规范。" })!,
      ];
      return {
        task,
        scenario,
        intent: {
          capabilityId: "contract.review",
          source: opts.source,
          confidence: opts.confidence,
        },
        prompt: opts.prompt,
        report: buildPromptBudgetReport({
          fragments,
          packed: packPromptFragments(fragments, 12_000),
          budgetTokens: 12_000,
        }),
      };
    };

    const good = observation({
      source: "joint",
      confidence: "high",
      skillChars: 4_000,
      prompt: "## 检索协议",
    });
    expect(checkMixedGenreBinding({ baseline: good, untypedPile: good, typedPile: good })).toEqual(
      [],
    );

    const degraded = observation({
      source: "keyword",
      confidence: "medium",
      skillChars: 500,
      prompt: "",
    });
    const messages = checkMixedGenreBinding({
      baseline: good,
      untypedPile: good,
      typedPile: degraded,
    })
      .map((violation) => violation.message)
      .join("\n");
    expect(messages).toContain("source 是 keyword");
    expect(messages).toContain("confidence 是 medium");
    expect(messages).toContain("缺少「## 检索协议」");
    expect(messages).toContain("应 ≥ 2000");
  });

  it("fails the P0 contract when a stage skill or protocol is lost", () => {
    const skill = createPromptFragment({
      kind: "skill_index",
      body: "# 本轮 LawMind 能力：合同审查\n\n分层审查。",
    })!;
    const protocol = createPromptFragment({
      kind: "protocol",
      body: "## 检索协议\n\n先查现行有效规范。",
    })!;
    const report = buildPromptBudgetReport({
      fragments: [skill, protocol],
      packed: [],
      budgetTokens: 1,
    });
    const violations = checkPromptBudgetObservation({
      task: PROMPT_BUDGET_BASELINE_TASKS.find((task) => task.id === "contract.review")!,
      scenario: PROMPT_BUDGET_BASELINE_SCENARIOS[0],
      report,
      prompt: "",
      intent: { capabilityId: "contract.review", source: "joint", confidence: "high" },
    });
    const messages = violations.map((violation) => violation.message).join("\n");
    expect(messages).toContain("Skill 片段被丢弃");
    expect(messages).toContain("协议被丢弃");
    expect(messages).toContain("缺少关键协议「## 检索协议」");
  });

  it("counts duplicate session craft as dedupe, never as a budget loss", async () => {
    const firstCraft = createPromptFragment({
      kind: "craft",
      body: "## 改稿要点\n\n只改律师标出的段落。",
    })!;
    const secondCraft = createPromptFragment({
      kind: "craft",
      body: "## 意见书要点\n\n先给结论。",
    })!;
    const protocol = createPromptFragment({
      kind: "protocol",
      body: "## 检索协议\n\n先查现行有效规范。",
    })!;
    const fragments = [firstCraft, secondCraft, protocol];
    const packed = packPromptFragments(fragments, 12_000);
    const report = buildPromptBudgetReport({ fragments, packed, budgetTokens: 12_000 });

    expect(report.keptCount).toBe(2);
    expect(report.collapsedCount).toBe(1);
    expect(report.collapsedKinds).toEqual(["craft"]);
    expect(report.droppedCount).toBe(0);
    expect(report.fragments[1]?.dropReason).toBe("duplicate_craft");
    expectCountsAddUp(report, "dedupe");

    recordPromptBudgetEvent(workspaceDir, report, { matterId: "m1" });
    const row = JSON.parse(
      fsSync.readFileSync(productMetricsPath(workspaceDir), "utf8").trim().split("\n").at(-1)!,
    ) as { outcome: string; meta: Record<string, string | number> };
    expect(row.outcome).toBe("complete");
    expect(row.meta.collapsedCount).toBe(1);
  });

  it("degrades the metric only for real losses (dropped fragment or half skill)", () => {
    const reportFor = (
      fragments: ReturnType<typeof createPromptFragment>[],
      budgetTokens: number,
    ) => {
      const present = fragments.filter((fragment) => fragment !== undefined);
      return buildPromptBudgetReport({
        fragments: present,
        packed: packPromptFragments(present, budgetTokens),
        budgetTokens,
      });
    };
    const readOutcome = () => {
      const lines = fsSync
        .readFileSync(productMetricsPath(workspaceDir), "utf8")
        .trim()
        .split("\n");
      return (
        JSON.parse(lines.at(-1)!) as { outcome: string; meta: Record<string, string | number> }
      ).outcome;
    };

    // Truncated pins are expected (visible overflow pointer) — not degraded.
    recordPromptBudgetEvent(
      workspaceDir,
      reportFor(
        [
          createPromptFragment({
            kind: "pins",
            body: "# 钉选材料\n\n合同正文…[截断，完整内容见工作区文件]",
          }),
        ],
        12_000,
      ),
    );
    expect(readOutcome()).toBe("complete");

    // A half skill is degraded.
    recordPromptBudgetEvent(
      workspaceDir,
      reportFor(
        [
          createPromptFragment({
            kind: "skill_index",
            body: "# 本轮 LawMind 能力：合同审查\n\n前半句…[截断，完整内容请用 read_skill 读取 skills]",
          }),
        ],
        12_000,
      ),
    );
    expect(readOutcome()).toBe("degraded");

    // A protocol dropped for budget is degraded.
    recordPromptBudgetEvent(
      workspaceDir,
      reportFor(
        [
          createPromptFragment({ kind: "skill_index", body: "# 能力\n\n规则" }),
          createPromptFragment({ kind: "protocol", body: "## 检索协议\n\n先查现行有效规范。" }),
        ],
        1,
      ),
    );
    expect(readOutcome()).toBe("degraded");
  });
});
