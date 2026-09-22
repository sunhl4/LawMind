import { describe, expect, it } from "vitest";
import {
  alignTerminology,
  detectTerminologyDrift,
  extractDefinedTerms,
  extractDefinedTermsFromText,
  introducedTerminologyDrift,
} from "./terminology-adapt.js";

const draftSections = [
  {
    heading: "当事人",
    body: [
      "甲方：北京示例科技有限公司（以下简称“公司”）",
      "乙方：李某",
      "本协议所称“生效日”系指双方签署之日。",
    ].join("\n"),
  },
];

describe("extractDefinedTerms", () => {
  it("pulls quoted definitions, parenthetical aliases and party labels", () => {
    const terms = extractDefinedTerms(draftSections);
    const byTerm = new Map(terms.map((t) => [t.term, t]));
    expect(byTerm.get("甲方")?.definition).toBe("北京示例科技有限公司");
    expect(byTerm.get("乙方")?.definition).toBe("李某");
    expect(byTerm.get("公司")?.aliases).toContain("北京示例科技有限公司");
    expect(byTerm.get("生效日")?.definition).toBe("双方签署之日");
  });

  it("returns an empty table for prose without explicit definitions", () => {
    expect(extractDefinedTerms([{ heading: "分析", body: "合同应当继续履行。" }])).toEqual([]);
  });
});

describe("detectTerminologyDrift", () => {
  const terms = extractDefinedTerms(draftSections);

  it("flags a party label the document never defines", () => {
    const drift = detectTerminologyDrift("买方应在十日内付款，甲方应开票。", terms);
    expect(drift.map((d) => d.token)).toEqual(["买方"]);
  });

  it("does not flag labels the document defines", () => {
    expect(detectTerminologyDrift("甲方与乙方签署本协议。", terms)).toEqual([]);
  });

  it("flags a name defined only inside the incoming text", () => {
    const drift = detectTerminologyDrift("本条所称“服务期”指交付之日起五年。", terms);
    expect(drift.map((d) => d.token)).toContain("服务期");
  });

  it("ignores ordinary nouns that are not party labels", () => {
    expect(detectTerminologyDrift("债权人可以请求继续履行。", terms)).toEqual([]);
  });
});

describe("alignTerminology", () => {
  const terms = extractDefinedTerms(draftSections);

  it("applies an explicit term map deterministically", () => {
    const result = alignTerminology({
      text: "买方应在十日内付款；买方逾期，卖方有权解除。",
      terms,
      termMap: { 买方: "甲方", 卖方: "乙方" },
    });
    expect(result.text).toBe("甲方应在十日内付款；甲方逾期，乙方有权解除。");
    expect(result.substitutions).toEqual([
      { from: "买方", to: "甲方", count: 2 },
      { from: "卖方", to: "乙方", count: 1 },
    ]);
    expect(result.unmappedForeignTerms).toEqual([]);
  });

  it("reports foreign labels the caller did not map", () => {
    const result = alignTerminology({
      text: "买方应在十日内付款，承包人应交付。",
      terms,
      termMap: { 买方: "甲方" },
    });
    expect(result.unmappedForeignTerms).toEqual(["承包人"]);
    expect(result.drift[0]?.token).toBe("承包人");
  });

  it("warns when the map target is not a term of the current document", () => {
    const result = alignTerminology({
      text: "卖方应交付。",
      terms,
      termMap: { 卖方: "承包方" },
    });
    expect(result.text).toBe("承包方应交付。");
    expect(result.warnings.join()).toContain("不是本文已定义术语");
  });

  it("leaves text untouched without a map and without drift", () => {
    const text = "甲方应在十日内开票。";
    const result = alignTerminology({ text, terms });
    expect(result.text).toBe(text);
    expect(result.substitutions).toEqual([]);
    expect(result.drift).toEqual([]);
  });
});

describe("introducedTerminologyDrift", () => {
  it("only reports labels newly brought in by the edit", () => {
    const before = "甲方：北京示例科技有限公司。买方应在十日内付款。";
    const after = "甲方：北京示例科技有限公司。买方应在十日内付款，承包人应交付。";
    expect(introducedTerminologyDrift(before, after).map((d) => d.token)).toEqual(["承包人"]);
  });

  it("reports nothing when the edit adds no foreign label", () => {
    const before = "甲方应在十日内付款。";
    const after = "甲方应在五个工作日内付款。";
    expect(introducedTerminologyDrift(before, after)).toEqual([]);
  });
});

describe("extractDefinedTermsFromText", () => {
  it("matches the sections-based extraction", () => {
    const text = draftSections.map((s) => s.body).join("\n");
    expect(extractDefinedTermsFromText(text)).toEqual(extractDefinedTerms(draftSections));
  });
});
