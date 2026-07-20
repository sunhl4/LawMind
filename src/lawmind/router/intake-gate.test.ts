import { describe, expect, it } from "vitest";
import {
  instructionLooksLikeFilledIntake,
  resolveIntakeClarificationQuestions,
} from "./intake-gate.js";

describe("intake-gate", () => {
  it("skips structured 【交办】 prompts", () => {
    const prompt = `【交办】合同审查意见
交付物类型：contract.review
交办要点：
- 审查重点：付款与违约
请按上述交办要点执行。`;
    expect(instructionLooksLikeFilledIntake(prompt)).toBe(true);
    expect(resolveIntakeClarificationQuestions(prompt)).toEqual([]);
  });

  it("asks review focus for thin contract review asks", () => {
    const qs = resolveIntakeClarificationQuestions("请审查这份合同");
    expect(qs.some((q) => q.key === "review_focus")).toBe(true);
  });

  it("asks rental parties when drafting a lease without facts", () => {
    const qs = resolveIntakeClarificationQuestions("请起草一份租赁合同");
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => q.key === "parties")).toBe(true);
  });
});
