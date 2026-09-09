import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractClauses } from "./extract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf-8");

describe("extractClauses", () => {
  it("extracts a typical NDA structure", () => {
    const doc = extractClauses(fixture("nda-simple.txt"));
    expect(doc.clauses).toHaveLength(4);
    expect(doc.clauses.map((c) => c.type)).toEqual([
      "definition",
      "obligation",
      "liability",
      "dispute",
    ]);
    expect(doc.clauses.map((c) => c.articleNo)).toEqual([1, 2, 3, 4]);
    expect(doc.definitions.has("保密信息")).toBe(true);

    const liability = doc.clauses[2];
    expect(liability?.type).toBe("liability");
    expect(liability?.children.map((c) => c.title)).toContain("赔偿上限");
    expect(liability?.children.map((c) => c.title)).toContain("不可抗力");

    // 引用：义务条款引用了保密信息定义
    const obligationRefs = doc.references.filter((r) => r.clauseId === doc.clauses[1]?.id);
    expect(obligationRefs.some((r) => r.kind === "term" && r.target === "保密信息")).toBe(true);
  });

  it("resolves 前款 to the previous article", () => {
    const doc = extractClauses(fixture("nda-simple.txt"));
    const previousRefs = doc.references.filter((r) => r.kind === "previous");
    expect(previousRefs.length).toBeGreaterThan(0);
    expect(previousRefs[0]?.target).toBe("2"); // 前款指向第二条（义务）
  });

  it("handles mixed Arabic and Chinese numerals", () => {
    const text = "第一条 定义。\n第2条 付款。\n第三条 交付。";
    const doc = extractClauses(text);
    expect(doc.clauses.map((c) => c.articleNo)).toEqual([1, 2, 3]);
  });

  it("resolves self and existing article references", () => {
    const text = "第三条 违约责任。根据第3条 第二款处理。";
    const doc = extractClauses(text);
    const articleRefs = doc.references.filter((r) => r.kind === "article");
    expect(articleRefs).toHaveLength(1);
    expect(articleRefs[0]?.target).toBe("3");
  });

  it("detects an undefined article reference", () => {
    const doc = extractClauses(fixture("with-undefined-ref.txt"));
    expect(doc.clauses).toHaveLength(2);
    const articleRefs = doc.references.filter((r) => r.kind === "article");
    expect(articleRefs.some((r) => r.target === "5")).toBe(true);
    expect(articleRefs.some((r) => r.target === "5" && r.clauseId === doc.clauses[1]?.id)).toBe(
      true,
    );
  });

  it("falls back to a single general clause when no article headings exist", () => {
    const doc = extractClauses("本合同由甲乙双方本着平等互利原则签订。");
    expect(doc.clauses).toHaveLength(1);
    expect(doc.clauses[0]?.type).toBe("general");
    expect(doc.clauses[0]?.body).toContain("平等互利");
  });

  it("keeps source ranges consistent with the original text", () => {
    const doc = extractClauses(fixture("nda-simple.txt"));
    for (const c of doc.clauses) {
      expect(c.sourceRange.startChar).toBeGreaterThanOrEqual(0);
      expect(c.sourceRange.endChar).toBeGreaterThanOrEqual(c.sourceRange.startChar);
      expect(c.sourceRange.endLine).toBeGreaterThanOrEqual(c.sourceRange.startLine);
    }
  });
});
