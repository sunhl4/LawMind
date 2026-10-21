/**
 * 抽取语义回归：正则是「找候选」，不是「下结论」。
 *
 * 背景（2026-10-20 复现）：材料把「甲方注册资本 100 万元」写在「本合同总价款 300 万元」
 * 之前时，旧实现取首个命中，于是「合同总价」这一格被填成 100 万，还带
 * `confidence: high` 与真实行号 —— 错了却看起来完全正确。
 * 这里把那条复现、以及「多主体 / 多日期 / 唯一候选」四类行为固定住。
 */

import { describe, expect, it } from "vitest";
import {
  columnRoleBigrams,
  createPatternExtractor,
  findCandidates,
  patternsForColumn,
  REVIEW_PATTERNS,
} from "./review-table-patterns.js";

const COLUMN_CONTRACT_PRICE = { key: "contract_price", label: "本合同总价款" };

function amountSpec() {
  return REVIEW_PATTERNS.find((p) => p.id === "amount")!;
}

describe("findCandidates returns every hit, not just the first", () => {
  it("lists all amounts with line numbers and the matched line", () => {
    const text = [
      "甲方注册资本人民币100万元。",
      "本合同总价款为人民币300万元。",
      "违约金为人民币20万元。",
    ].join("\n");
    const candidates = findCandidates(text, amountSpec(), { column: COLUMN_CONTRACT_PRICE });
    expect(candidates.map((c) => c.locator)).toEqual(["line=1", "line=2", "line=3"]);
    expect(candidates.map((c) => c.value)).toEqual([
      "人民币100万元",
      "人民币300万元",
      "人民币20万元",
    ]);
  });

  it("marks only the line whose wording matches the column role", () => {
    const text = ["甲方注册资本人民币100万元。", "本合同总价款为人民币300万元。"].join("\n");
    const candidates = findCandidates(text, amountSpec(), { column: COLUMN_CONTRACT_PRICE });
    expect(candidates[0]?.roleSupported).toBe(false);
    expect(candidates[1]?.roleSupported).toBe(true);
  });

  it("caps the candidate list so a long attachment cannot flood the cell", () => {
    const text = Array.from({ length: 30 }, (_, i) => `第${i + 1}项金额人民币${i + 1}万元。`).join(
      "\n",
    );
    const candidates = findCandidates(text, amountSpec(), { maxCandidates: 3 });
    expect(candidates).toHaveLength(3);
  });
});

describe("columnRoleBigrams ignores generic column wording", () => {
  it("keeps field-specific bigrams and drops generic ones", () => {
    const bigrams = columnRoleBigrams(COLUMN_CONTRACT_PRICE);
    expect(bigrams).toContain("合同");
    expect(bigrams).toContain("总价");
    expect(bigrams).not.toContain("价款");
  });
});

describe("createPatternExtractor refuses to guess between candidates", () => {
  const extract = createPatternExtractor();

  it("reports ambiguity instead of returning the first amount with high confidence", async () => {
    const text = [
      "甲方注册资本人民币100万元。",
      "本合同总价款为人民币300万元。",
      "违约金为人民币20万元。",
    ].join("\n");
    const result = await extract({
      doc: { relPath: "cases/m/materials/合同.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text,
      fromOcr: false,
    });

    // 旧行为：{ ok: true, value: "人民币100万元", confidence: "high" }
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("应当判为歧义，不应给出唯一值");
    }
    expect(result.ambiguous).toBe(true);
    expect(result.candidates?.map((c) => c.value)).toContain("人民币300万元");
    expect(result.reason).toContain("本合同总价款");
  });

  it("does not promote a wrong single amount using only the word 合同", async () => {
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text: "本合同仅说明甲方注册资本100万元，总价另议。",
      fromOcr: false,
    });
    expect(result).toMatchObject({ ok: true, basis: "pattern_only" });
  });

  it("keeps all distinct amounts ambiguous even if one matches the requested field", async () => {
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text: "本合同总价款300万元。\n履约保证金20万元。",
      fromOcr: false,
    });
    expect(result).toMatchObject({ ok: false, ambiguous: true });
  });

  it("uses the single role-matching candidate when only one amount exists", async () => {
    const text = "本合同总价款为人民币300万元。";
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text,
      fromOcr: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toBe("人民币300万元");
    expect(result.basis).toBe("exact_quote");
    expect(result.confidence).toBe("high");
  });

  it("downgrades to pattern_only when no line carries the column role", async () => {
    const text = "甲方注册资本人民币100万元。";
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text,
      fromOcr: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toBe("人民币100万元");
    expect(result.basis).toBe("pattern_only");
    // 只有模式命中，不能给 high。
    expect(result.confidence).not.toBe("high");
    expect(result.note).toContain("核对");
  });

  it("stays ambiguous for multiple parties when the column names one role", async () => {
    const text = "甲方：北京甲公司\n乙方：上海乙公司\n丙方：广州丙公司";
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: { key: "opposing_party", label: "对方当事人" },
      text,
      fromOcr: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("多个主体不应猜");
    }
    expect(result.ambiguous).toBe(true);
  });

  it("keeps abstaining (not guessing) when the pattern finds nothing", async () => {
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: COLUMN_CONTRACT_PRICE,
      text: "本合同没有写任何金额。",
      fromOcr: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.ambiguous).toBeUndefined();
    expect(result.reason).toContain("未检出");
  });

  it("still abstains for a column with no deterministic pattern", async () => {
    const result = await extract({
      doc: { relPath: "a.txt" },
      column: { key: "risk_note", label: "风险提示" },
      text: "本合同总价款为人民币300万元。",
      fromOcr: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain("无确定性模式");
  });

  it("maps the price column to the amount pattern only", () => {
    expect(patternsForColumn(COLUMN_CONTRACT_PRICE).map((p) => p.id)).toEqual(["amount"]);
  });
});
