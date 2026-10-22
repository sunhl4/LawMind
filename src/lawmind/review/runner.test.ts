import { describe, expect, it } from "vitest";
import type { RuleWorkerOutput } from "./execute.js";
import { planRuleReview } from "./plan.js";
import { CN_SALES_RULES } from "./playbooks/cn-sales.js";
import { runRuleAssignments, type RuleRunEvent } from "./runner.js";

const plan = planRuleReview({
  playbookId: "cn-sales-v0",
  rules: CN_SALES_RULES,
  paper: "counterparty",
});

function outputFor(ruleId: string): RuleWorkerOutput {
  return {
    ruleId,
    agentId: `agent:${ruleId}`,
    branchId: `branch:${ruleId}`,
    classification: { kind: "compliant", ruleId },
    ops: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runRuleAssignments: concurrency", () => {
  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const gate = deferred<void>();

    const running = runRuleAssignments(
      plan.assignments,
      async (assignment) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
        return outputFor(assignment.ruleId);
      },
      { concurrency: 2, timeoutMs: 1_000 },
    );

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 5));
    expect(peak).toBe(2);
    gate.resolve();
    const result = await running;
    expect(result.outputs).toHaveLength(6);
    expect(result.failures).toEqual([]);
  });
});

describe("runRuleAssignments: timeout and targeted retry", () => {
  it("retries only the timed-out rule, not the whole plan", async () => {
    const attempts = new Map<string, number>();
    const slowRule = plan.assignments[1].ruleId;

    const result = await runRuleAssignments(
      plan.assignments,
      async (assignment) => {
        const n = (attempts.get(assignment.ruleId) ?? 0) + 1;
        attempts.set(assignment.ruleId, n);
        if (assignment.ruleId === slowRule && n === 1) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return outputFor(assignment.ruleId);
      },
      { concurrency: 6, timeoutMs: 20, maxAttempts: 2, backoffMs: 0 },
    );

    expect(result.failures).toEqual([]);
    expect(result.outputs).toHaveLength(6);
    expect(attempts.get(slowRule)).toBe(2);
    // Every other rule ran exactly once.
    for (const a of plan.assignments) {
      if (a.ruleId !== slowRule) {
        expect(attempts.get(a.ruleId)).toBe(1);
      }
    }
  });

  it("reports a failure instead of failing the whole review", async () => {
    const badRule = plan.assignments[0].ruleId;
    const result = await runRuleAssignments(
      plan.assignments,
      async (assignment) => {
        if (assignment.ruleId === badRule) {
          throw new Error("model exploded");
        }
        return outputFor(assignment.ruleId);
      },
      { concurrency: 6, timeoutMs: 500, maxAttempts: 1 },
    );

    expect(result.outputs).toHaveLength(5);
    expect(result.failures).toEqual([{ ruleId: badRule, error: "model exploded" }]);
  });
});

describe("runRuleAssignments: streaming", () => {
  it("emits each rule result as soon as it finishes", async () => {
    const events: RuleRunEvent[] = [];
    const fast = plan.assignments[0].ruleId;
    const slow = plan.assignments[5].ruleId;

    await runRuleAssignments(
      plan.assignments,
      async (assignment) => {
        if (assignment.ruleId === slow) {
          await new Promise((r) => setTimeout(r, 30));
        }
        return outputFor(assignment.ruleId);
      },
      {
        concurrency: 6,
        timeoutMs: 500,
        onEvent: (e) => events.push(e),
      },
    );

    const finished = events.filter((e) => e.type === "rule_finished");
    expect(finished).toHaveLength(6);
    // The fast rule is reported before the slow one (streaming, not batch).
    const fastIndex = finished.findIndex((e) => e.type === "rule_finished" && e.ruleId === fast);
    const slowIndex = finished.findIndex((e) => e.type === "rule_finished" && e.ruleId === slow);
    expect(fastIndex).toBeLessThan(slowIndex);
  });

  it("respects an abort signal", async () => {
    const controller = new AbortController();
    const result = await runRuleAssignments(
      plan.assignments,
      async (assignment) => {
        controller.abort();
        return outputFor(assignment.ruleId);
      },
      {
        concurrency: 1,
        timeoutMs: 500,
        maxAttempts: 1,
        signal: controller.signal,
      },
    );
    // First rule completes; the rest are skipped as aborted.
    expect(result.outputs.length).toBeLessThanOrEqual(1);
    expect(result.failures.length).toBeGreaterThan(0);
  });
});
