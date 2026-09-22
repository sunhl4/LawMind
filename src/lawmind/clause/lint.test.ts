import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultClausePatterns } from "./dsl.js";
import { runClauseLint } from "./lint.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf-8");

describe("runClauseLint", () => {
  it("flags undefined article references", () => {
    const findings = runClauseLint(fixture("with-undefined-ref.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.undefined_article_ref");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("第 5 条");
    expect(hit?.level).toBe("warning");
  });

  it("flags an undefined quoted term", () => {
    const text = "第一条 标的物\n甲方使用「未定义术语」进行说明。\n第二条 争议解决\n提交法院。";
    const findings = runClauseLint(text);
    const hit = findings.find((f) => f.ruleId === "clause.undefined_term");
    expect(hit).toBeDefined();
    expect(hit?.message).toContain("未定义术语");
  });

  it("info when obligations exist but no liability clause", () => {
    const findings = runClauseLint(fixture("obligations-only.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.obligation_without_liability");
    expect(hit).toBeDefined();
    expect(hit?.level).toBe("info");
  });

  it("warns when a dispute clause is missing", () => {
    const findings = runClauseLint(fixture("obligations-only.txt"));
    const hit = findings.find((f) => f.ruleId === "clause.dispute_missing");
    expect(hit).toBeDefined();
    expect(hit?.level).toBe("warning");
  });

  it("passes a well-structured NDA", () => {
    const findings = runClauseLint(fixture("nda-simple.txt"));
    expect(findings.find((f) => f.ruleId === "clause.undefined_article_ref")).toBeUndefined();
    expect(findings.find((f) => f.ruleId === "clause.undefined_term")).toBeUndefined();
    expect(findings.find((f) => f.ruleId === "clause.dispute_missing")).toBeUndefined();
  });
});

/**
 * 已知误报（**特性化测试，不是期望行为**）。
 *
 * `clause.dispute_missing` 在「争议解决条款与其它内容写在同一行」的合同上会误报，
 * 根因是 `dsl.ts` 的 `obligations()` 触发词含单字「应」、且 `dispute()` 在
 * `classifyClause` 的数组顺序里排在它后面——「双方**应**提交…仲裁」先被认成义务条款。
 *
 * 这些断言的作用是**把 `guardian/machine-verifiers.ts` 里「为什么不把
 * `clause.dispute_missing` 接进 `forum.form_valid`」的决定钉在可复现的证据上**。
 * 若哪天 dispute 的触发词/顺序被修正（需法律顾问复核），这里会红——
 * 那正是「重新评估是否接入」的信号，不是回归。
 */
describe("clause.dispute_missing 的已知误报（供机器验证器决策引用）", () => {
  it("条款写在正文行内时误报（真实 fixture 与短合同都能复现）", () => {
    const inline = [
      "第一条 甲方与乙方就设备采购达成如下协议。",
      "第二条 合同总价款为 1,032,000 元。",
      "第三条 因本合同发生的争议，双方应提交北京仲裁委员会仲裁。",
    ].join("\n");
    expect(runClauseLint(inline).map((f) => f.ruleId)).toContain("clause.dispute_missing");
    expect(
      runClauseLint(fixture("../../../../fixtures/lawmind-round/purchase-contract.md")).map(
        (f) => f.ruleId,
      ),
    ).toContain("clause.dispute_missing");
  });

  it("条款带小标题（「争议解决」）时不误报——问题在分类，不在有没有写", () => {
    const headed = [
      "第一条 标的",
      "甲方向乙方采购设备 12 台。",
      "第二条 争议解决",
      "因本合同发生的争议，双方应提交北京仲裁委员会仲裁。",
    ].join("\n");
    expect(runClauseLint(headed).map((f) => f.ruleId)).not.toContain("clause.dispute_missing");
  });

  it("传默认模式表与不传 patterns 是同一件事（不是「没注入 patterns 才误报」）", () => {
    const inline =
      "第一条 双方应履行义务。\n第二条 因本合同发生的争议，双方应提交北京仲裁委员会仲裁。";
    expect(
      runClauseLint(inline)
        .map((f) => f.ruleId)
        .filter((r) => r === "clause.dispute_missing"),
    ).toEqual(
      runClauseLint(inline, defaultClausePatterns())
        .map((f) => f.ruleId)
        .filter((r) => r === "clause.dispute_missing"),
    );
    // 空数组才是「没有 patterns」——那种情况下**每一份**文本都会误报
    expect(
      runClauseLint("第一条 甲方付款。\n第二条 乙方交付。", [])
        .map((f) => f.ruleId)
        .filter((r) => r === "clause.dispute_missing"),
    ).toHaveLength(1);
  });
});
