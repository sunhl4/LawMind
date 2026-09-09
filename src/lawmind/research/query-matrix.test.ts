import { describe, expect, it } from "vitest";
import { buildQueryMatrix, formatQueryMatrixBody } from "./query-matrix.js";

describe("query-matrix", () => {
  it("fills 违约责任 with a liquidated-damages matrix", () => {
    const matrix = buildQueryMatrix("查一下民法典违约责任");
    expect(matrix.forward).toContain("违约金");
    expect(matrix.reverse).toMatch(/过分高于|调整/);
    expect(matrix.queryTerms).toContain("违约金");
    const body = formatQueryMatrixBody(matrix, false);
    expect(body).toContain("试检 1–2 条");
    expect(body).toContain("正向命题");
    expect(body).toContain("反向命题");
  });

  it("notes when retrieval already ran", () => {
    const matrix = buildQueryMatrix("诉讼时效抗辩");
    expect(formatQueryMatrixBody(matrix, true)).toContain("已有检索结果");
  });
});
