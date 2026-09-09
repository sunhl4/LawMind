import { describe, expect, it } from "vitest";
import { inferMatterKind, parseMatterDocket, parseMatterKind } from "./matter-kind.js";

describe("matter-kind", () => {
  it("parses known kinds and falls back to general", () => {
    expect(parseMatterKind("litigation")).toBe("litigation");
    expect(parseMatterKind("nope")).toBe("general");
  });

  it("infers litigation from summons / hearing language", () => {
    expect(inferMatterKind("把这张传票入卷，下周二开庭")).toBe("litigation");
    expect(inferMatterKind("审查这份买卖合同的违约责任")).toBe("contract");
    expect(inferMatterKind("随便记一下")).toBe("general");
  });

  it("parses sparse docket objects", () => {
    expect(parseMatterDocket({ caseNo: "（2026）京01民初1号", court: "  " })).toEqual({
      caseNo: "（2026）京01民初1号",
    });
    expect(parseMatterDocket(null)).toBeUndefined();
  });
});
