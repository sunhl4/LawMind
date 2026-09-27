import { describe, expect, it } from "vitest";
import {
  inferMatterKind,
  parseMatterDocket,
  parseMatterKind,
  resolveMatterKind,
} from "./matter-kind.js";

describe("matter-kind", () => {
  it("parses known kinds and falls back to general", () => {
    expect(parseMatterKind("litigation")).toBe("litigation");
    expect(parseMatterKind("nope")).toBe("general");
  });

  it("infers work mode, not the word 合同 inside a cause of action", () => {
    expect(inferMatterKind("把这张传票入卷，下周二开庭")).toBe("litigation");
    expect(inferMatterKind("买卖合同纠纷")).toBe("litigation");
    expect(inferMatterKind("星辉精密诉环宇科技 · 买卖合同纠纷")).toBe("litigation");
    expect(inferMatterKind("劳动争议")).toBe("litigation");
    expect(inferMatterKind("审查这份买卖合同的违约责任")).toBe("contract");
    expect(inferMatterKind("审查这份买卖合同，注意纠纷解决条款")).toBe("contract");
    expect(inferMatterKind("采购框架协议审查")).toBe("contract");
    expect(inferMatterKind("江苏岚江智能科技有限公司 常年法律顾问服务")).toBe("general");
    expect(inferMatterKind("非诉讼法律顾问")).toBe("general");
    expect(inferMatterKind("常年法律顾问（非诉讼）")).toBe("general");
    expect(inferMatterKind("审查这份合同的争议条款")).toBe("contract");
    expect(inferMatterKind("随便记一下")).toBe("general");
  });

  it("rewrites an explicit 合同 label when the title is a lawsuit or a retainer", () => {
    expect(resolveMatterKind("contract", "买卖合同纠纷")).toEqual({
      kind: "litigation",
      adjusted: true,
      reason: "标题是诉讼案由或法院程序，门类改为诉讼。案由里的「合同」不是合同审查。",
    });
    expect(resolveMatterKind("contract", "常年法律顾问服务")).toMatchObject({
      kind: "general",
      adjusted: true,
    });
    expect(resolveMatterKind("contract", "采购框架协议审查")).toEqual({
      kind: "contract",
      adjusted: false,
    });
    expect(resolveMatterKind(undefined, "随便记一下").kind).toBe("general");
    expect(resolveMatterKind("general", "买卖合同纠纷").kind).toBe("general");
  });

  it("parses sparse docket objects", () => {
    expect(parseMatterDocket({ caseNo: "（2026）京01民初1号", court: "  " })).toEqual({
      caseNo: "（2026）京01民初1号",
    });
    expect(parseMatterDocket(null)).toBeUndefined();
  });
});
