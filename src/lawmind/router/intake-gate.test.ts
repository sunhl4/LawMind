import { describe, expect, it } from "vitest";
import {
  caseMemoryLooksFilledForIntake,
  instructionHasPinnedMaterials,
  instructionLooksLikeFilledIntake,
  instructionRequestsIntakeEscape,
  resolveIntakeAdvisoryQuestions,
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
    expect(resolveIntakeAdvisoryQuestions(prompt)).toEqual([]);
  });

  it("soft-asks review focus without hard-freezing thin contract review", () => {
    expect(resolveIntakeClarificationQuestions("请审查这份合同")).toEqual([]);
    const advisory = resolveIntakeAdvisoryQuestions("请审查这份合同");
    expect(advisory.some((q) => q.key === "review_focus" || q.key === "review_materials")).toBe(
      true,
    );
  });

  it("skips intake for mail-contract short-path instructions", () => {
    const instruction = [
      "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
      "matterId=`临时讨论`",
      "默认 contract_edit_baseline_path=`cases/临时讨论/mail/attachments/x/a.docx`",
      "修改协议，谢谢。",
      "render_tracked_draft",
    ].join("\n");
    expect(resolveIntakeClarificationQuestions(instruction)).toEqual([]);
    expect(resolveIntakeAdvisoryQuestions(instruction)).toEqual([]);
  });

  it("detects pinned materials in instruction", () => {
    expect(
      instructionHasPinnedMaterials(
        "默认 contract_edit_baseline_path=`cases/m/mail/attachments/x/a.docx`",
      ),
    ).toBe(true);
  });

  it("soft-asks rental draft without hard freeze", () => {
    expect(resolveIntakeClarificationQuestions("请起草一份租赁合同")).toEqual([]);
    expect(resolveIntakeAdvisoryQuestions("请起草一份租赁合同").length).toBeGreaterThan(0);
  });

  it("hard-gates demand letter without materials", () => {
    const qs = resolveIntakeClarificationQuestions("请写一份律师函催款");
    expect(qs.length).toBeGreaterThan(0);
  });

  it("does not pause a generic counsel letter or complaint", () => {
    expect(resolveIntakeClarificationQuestions("起草一份律师函")).toEqual([]);
    expect(resolveIntakeClarificationQuestions("写起诉状")).toEqual([]);
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
    expect(caseMemoryLooksFilledForIntake(caseMemory, "contract.rental")).toBe(true);
    expect(resolveIntakeAdvisoryQuestions("请起草一份租赁合同", { caseMemory })).toEqual([]);
  });

  it("respects intakeHeuristicsEnabled=false", () => {
    expect(
      resolveIntakeClarificationQuestions("请写一份律师函催款", { intakeHeuristicsEnabled: false }),
    ).toEqual([]);
  });

  it("skips when hasContextPins", () => {
    expect(resolveIntakeAdvisoryQuestions("请审查这份合同", { hasContextPins: true })).toEqual([]);
  });

  it("skips advisory when baseline path is pinned in instruction", () => {
    expect(
      resolveIntakeAdvisoryQuestions(
        "请审查这份合同 contract_edit_baseline_path=`cases/m/mail/attachments/x/a.docx`",
      ),
    ).toEqual([]);
  });

  it("hard-gates litigation outline without materials", () => {
    const qs = resolveIntakeClarificationQuestions("请写一份起诉状诉讼大纲");
    expect(qs.length).toBeGreaterThan(0);
  });
});
