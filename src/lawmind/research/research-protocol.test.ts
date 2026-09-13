import { describe, expect, it } from "vitest";
import {
  formatResearchProtocolPromptBlock,
  formatUnretrievedStatuteBody,
  looksLikeStatuteCitation,
  shouldInjectResearchProtocol,
  statuteTrialHappenedThisTurn,
} from "./research-protocol.js";

describe("research-protocol", () => {
  it("injects on unlocked 意见 / 检索 / 快问, not mail or Word lock", () => {
    expect(
      shouldInjectResearchProtocol({ id: "research.memo", pipeline: "research_then_draft" }),
    ).toBe(true);
    expect(
      shouldInjectResearchProtocol({ id: "contract.review", pipeline: "execute_workflow" }),
    ).toBe(true);
    expect(
      shouldInjectResearchProtocol({ id: "analysis.quick", pipeline: "research_then_draft" }),
    ).toBe(true);
    expect(
      shouldInjectResearchProtocol({ id: "contract.review", pipeline: "tracked_redline" }),
    ).toBe(false);
    expect(
      shouldInjectResearchProtocol({ id: "mail.contract", pipeline: "execute_workflow" }),
    ).toBe(false);
    expect(
      shouldInjectResearchProtocol(
        { id: "contract.review", pipeline: "execute_workflow" },
        {
          instruction:
            "【交办】5 分钟合同审查\n交付物类型：合同审查意见\n- 己方立场：中立\n- 审查重点：管辖",
        },
      ),
    ).toBe(false);
    expect(
      shouldInjectResearchProtocol(
        { id: "contract.review", pipeline: "execute_workflow" },
        { availableToolNames: ["draft_document", "render_document"] },
      ),
    ).toBe(false);
    expect(formatResearchProtocolPromptBlock()).toContain("search_statute");
    expect(formatUnretrievedStatuteBody()).toContain("待核实");
  });

  it("detects this-turn statute trial from tool counts", () => {
    expect(statuteTrialHappenedThisTurn(undefined)).toBe(false);
    expect(statuteTrialHappenedThisTurn({})).toBe(false);
    expect(statuteTrialHappenedThisTurn({ search_statute: 1 })).toBe(true);
    expect(statuteTrialHappenedThisTurn({ search_case_law: 2 })).toBe(true);
    expect(looksLikeStatuteCitation("见《民法典》第577条")).toBe(true);
    expect(looksLikeStatuteCitation("无引用")).toBe(false);
  });
});
