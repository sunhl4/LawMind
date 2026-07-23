import { describe, expect, it } from "vitest";
import {
  caseMemoryLooksFilledForIntake,
  instructionLooksLikeFilledIntake,
  instructionRequestsIntakeEscape,
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

  it("skips when lawyer requests escape hatch", () => {
    expect(instructionRequestsIntakeEscape("直接做，别再问了")).toBe(true);
    expect(resolveIntakeClarificationQuestions("请起草一份租赁合同，继续不澄清")).toEqual([]);
  });

  it("skips when CASE memory already has parties and type", () => {
    const caseMemory = `
# 案件
当事人：甲方上海甲公司，乙方北京乙公司
文书类型：租赁合同
事实：房屋位于浦东，租期三年。
更多背景说明与沟通记录若干行以充实档案内容。
`;
    expect(caseMemoryLooksFilledForIntake(caseMemory, "contract.lease")).toBe(true);
    expect(resolveIntakeClarificationQuestions("请起草一份租赁合同", { caseMemory })).toEqual([]);
  });

  it("respects intakeHeuristicsEnabled=false", () => {
    expect(
      resolveIntakeClarificationQuestions("请审查这份合同", { intakeHeuristicsEnabled: false }),
    ).toEqual([]);
  });
});
