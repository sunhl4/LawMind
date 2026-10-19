import { describe, expect, it } from "vitest";
import { normalizeReviewObservations, renderReviewObservations } from "./review-observations.js";

describe("review observation protocol (docs/量子启发.md §二(6))", () => {
  it("accepts observations that carry an anchor, a span, and a label", () => {
    const batch = normalizeReviewObservations([
      {
        anchor: "clause:解除",
        span: "甲方违反本约定逾三十日，乙方可解除合同",
        label: "解除条款所指「甲方」疑似写反，合同当事人是乙方承租",
        sourceId: "lease-v1",
        version: "2026-09-30",
      },
      { anchor: "amount:wage", span: "月薪 15000 元", label: "与账本月薪一致，无需处置" },
    ]);
    expect(batch.rejected).toEqual([]);
    expect(batch.accepted).toHaveLength(2);
    expect(batch.accepted[0]?.sourceId).toBe("lease-v1");
    expect(batch.accepted[1]?.sourceId).toBeUndefined();
  });

  it("rejects entries without an anchor, with a non-fact anchor, or without a span", () => {
    const batch = normalizeReviewObservations([
      { span: "没有锚", label: "缺锚" },
      { anchor: "总结一下全文", span: "片段", label: "锚不是 fact-anchor 形态" },
      { anchor: "clause:解除", label: "缺原文片段" },
      { anchor: "clause:解除", span: "片段" },
      "裸字符串",
      null,
      ["嵌套数组"],
    ]);
    expect(batch.accepted).toEqual([]);
    expect(batch.rejected.map((row) => row.reason)).toEqual([
      "missing_anchor",
      "anchor_shape",
      "missing_span",
      "missing_label",
      "not_an_object",
      "not_an_object",
      "not_an_object",
    ]);
  });

  it("rejects the input entirely when the payload is not an array", () => {
    expect(normalizeReviewObservations(undefined)).toEqual({ accepted: [], rejected: [] });
    const batch = normalizeReviewObservations({ anchor: "clause:解除" });
    expect(batch.accepted).toEqual([]);
    expect(batch.rejected).toEqual([{ index: 0, reason: "not_an_object" }]);
  });

  it("renders every accepted entry with its span and the observe-only notice", () => {
    const rendered = renderReviewObservations([
      {
        anchor: "clause:解除",
        span: "乙方未按约定支付租金，甲方可解除",
        label: "违约主体与合同定义相反",
        sourceId: "lease-v1",
      },
    ]);
    expect(rendered).toContain("【审稿观察】");
    expect(rendered).toContain("clause:解除（lease-v1）");
    expect(rendered).toContain("原文片段：乙方未按约定支付租金，甲方可解除");
    expect(rendered).toContain("不改稿、不选边、不升级账本读数");
  });

  it("renders nothing for an empty batch", () => {
    expect(renderReviewObservations([])).toBe("");
  });
});
