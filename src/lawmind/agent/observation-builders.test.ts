import { describe, expect, it } from "vitest";
import { emptyFactorState, linkNeighbors, recordReading } from "./factor-state.js";
import {
  definitionAliasEdges,
  relationEnvelopeFromState,
  reviewEnvelopeFromToolData,
  witnessEnvelopeFromToolData,
} from "./observation-builders.js";

describe("factor observation builders", () => {
  it("scores witness answers without mutating the factor state", () => {
    const state = emptyFactorState();
    recordReading(state, "amount:wage", "amount", "15000", true);
    const before = JSON.stringify(state);
    const envelope = witnessEnvelopeFromToolData(state, {
      witnessAnswers: [{ anchor: "amount:wage", answer: "15,000 元" }],
    });
    expect(envelope?.kind).toBe("witness");
    expect(envelope?.payload.verdict).toBe("pass");
    expect(JSON.stringify(state)).toBe(before);
  });

  it("rejects witness answers that do not match a generated probe", () => {
    const state = emptyFactorState();
    recordReading(state, "amount:wage", "amount", "15000", true);
    expect(
      witnessEnvelopeFromToolData(state, {
        witnessAnswers: [{ anchor: "amount:missing", answer: "15000 元" }],
      }),
    ).toBeUndefined();
  });

  it("normalizes review observations and keeps rejected rows in the payload", () => {
    const envelope = reviewEnvelopeFromToolData({
      reviewObservations: [
        { anchor: "clause:解除", span: "甲方可解除", label: "主体待核" },
        { anchor: "not-a-factor", span: "原文", label: "缺锚形态" },
      ],
    });
    expect(envelope?.kind).toBe("review");
    expect(envelope?.payload.accepted).toHaveLength(1);
    expect(envelope?.payload.rejected).toHaveLength(1);
  });

  it("builds relation observations only from existing typed alias edges", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "公司：北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:承租人",
      "clause",
      "上海示例贸易有限公司",
      true,
      "承租人：上海示例贸易有限公司",
    );
    linkNeighbors(state, "defined:公司", "defined:承租人");
    expect(definitionAliasEdges(state)).toEqual([
      { kind: "alias_equality", anchors: ["defined:公司", "defined:承租人"] },
    ]);
    const envelope = relationEnvelopeFromState(state);
    expect(envelope?.kind).toBe("relation");
    expect(envelope?.payload.conflicts).toHaveLength(1);
    expect(envelope?.payload.rendered).toContain("不选边");
  });

  it("does not emit a relation observation for a clean edge", () => {
    const state = emptyFactorState();
    recordReading(
      state,
      "defined:公司",
      "clause",
      "北京示例科技有限公司",
      true,
      "公司：北京示例科技有限公司",
    );
    recordReading(
      state,
      "defined:甲方",
      "clause",
      "北京示例科技有限公司",
      true,
      "甲方：北京示例科技有限公司",
    );
    linkNeighbors(state, "defined:公司", "defined:甲方");
    expect(relationEnvelopeFromState(state)).toBeUndefined();
  });
});
