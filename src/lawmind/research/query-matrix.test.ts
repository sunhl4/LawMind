import { describe, expect, it } from "vitest";
import { buildQueryMatrix, formatQueryMatrixBody, instructionQueryTerms } from "./query-matrix.js";

describe("query-matrix", () => {
  it("fills 违约责任 with a liquidated-damages matrix", () => {
    const matrix = buildQueryMatrix("查一下民法典违约责任");
    expect(matrix.forward).toContain("违约金");
    expect(matrix.reverse).toMatch(/过分高于|调整/);
    expect(matrix.queryTerms).toContain("违约金");
    expect(buildQueryMatrix("股权转让合同约定违约金按日万分之五").queryTerms).toContain("股权");
    const body = formatQueryMatrixBody(matrix, false);
    expect(body).toContain("试检 1–2 条");
    expect(body).toContain("正向命题");
    expect(body).toContain("反向命题");
  });

  it("builds query words from the instruction when no preset issue matches", () => {
    const matrix = buildQueryMatrix("股权回购价格怎么定");
    expect(matrix.queryTerms).toContain("股权");
    expect(matrix.queryTerms).not.toContain("名称+可能条号");
    expect(instructionQueryTerms("股权回购价格怎么定")).toBe(matrix.queryTerms);
  });

  it("notes when retrieval already ran", () => {
    const matrix = buildQueryMatrix("诉讼时效抗辩");
    expect(formatQueryMatrixBody(matrix, true)).toContain("已有检索结果");
  });
});
