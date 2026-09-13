import { describe, expect, it } from "vitest";
import {
  isOpinionOnlyFastLane,
  RESEARCH_PROTOCOL_TOOLS,
  SURGICAL_PROTOCOL_TOOLS,
  toolsAllowAny,
} from "./prompt-protocol-gate.js";

describe("prompt-protocol-gate", () => {
  it("treats 5-minute 交办 as opinion-only, not 办件 contract.review", () => {
    expect(
      isOpinionOnlyFastLane(
        "【交办】5 分钟合同审查\n交付物类型：合同审查意见\n- 己方立场：中立\n- 审查重点：管辖",
      ),
    ).toBe(true);
    expect(isOpinionOnlyFastLane("【办件】能力：contract.review\n流程：合同审查")).toBe(false);
    expect(isOpinionOnlyFastLane(undefined)).toBe(false);
  });

  it("does not infer a tool lock when the name list is omitted", () => {
    expect(toolsAllowAny(undefined, RESEARCH_PROTOCOL_TOOLS)).toBe(true);
    expect(toolsAllowAny(["draft_document"], RESEARCH_PROTOCOL_TOOLS)).toBe(false);
    expect(toolsAllowAny(["search_statute", "draft_document"], RESEARCH_PROTOCOL_TOOLS)).toBe(true);
    expect(toolsAllowAny(["render_document"], SURGICAL_PROTOCOL_TOOLS)).toBe(false);
  });
});
