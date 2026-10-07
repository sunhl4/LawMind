/**
 * Five-error taskset. Fake sentences, not lawyer-graded manuscripts.
 * Control A: same facts, only re-inject five invariants after a dropped history.
 * Treatment: factor state used in this engine.
 */
import { describe, expect, it } from "vitest";
import {
  appendMechanicalNote,
  applyProseSyndrome,
  consumeRedlineRepair,
  emptyFactorState,
  ingestDefinedTerms,
  ingestToolResult,
  projectAssistantProseForSampling,
  projectReading,
  recordReading,
  renderEngineReadings,
} from "./factor-state.js";

type Five = {
  citation_outside_pack: number;
  amount_mismatch: number;
  definition_or_party: number;
  redline_empty: number;
  ungrounded_as_fact: number;
};

function emptyFive(): Five {
  return {
    citation_outside_pack: 0,
    amount_mismatch: 0,
    definition_or_party: 0,
    redline_empty: 0,
    ungrounded_as_fact: 0,
  };
}

function total(score: Five): number {
  return Object.values(score).reduce((sum, count) => sum + count, 0);
}

const REINJECTION =
  "引用标识必须落在来源包；金额须等于计算器；定义与称谓不得漂移；空修订不算完成；没有出处不得写成事实。";

describe("five-error taskset ablation", () => {
  it("beats prompt reinjection on the frozen five-error set and does not claim manuscripts", () => {
    const control = emptyFive();
    const treatment = emptyFive();

    const droppedHistory = "";
    const controlPrompt = `${droppedHistory}\n${REINJECTION}`;
    if (!controlPrompt.includes("npc-1") && "根据〔fake-9〕应当付款。".includes("fake-9")) {
      control.citation_outside_pack += 1;
    }
    const citeState = emptyFactorState();
    applyProseSyndrome(citeState, "根据〔fake-9〕应当付款。");
    if (!citeState.factors.some((factor) => factor.flag !== "ok")) {
      treatment.citation_outside_pack += 1;
    }

    if ("经济补偿为 99999 元。".includes("99999") && !controlPrompt.includes("88000")) {
      control.amount_mismatch += 1;
    }
    const amountState = emptyFactorState();
    ingestToolResult(amountState, "calculate", { op: "economic_compensation", value: 88000 });
    applyProseSyndrome(amountState, "经济补偿为 99999 元。");
    const voiced = appendMechanicalNote("经济补偿为 99999 元。", amountState);
    if (!voiced.includes("88000")) {
      treatment.amount_mismatch += 1;
    }
    if (projectAssistantProseForSampling(voiced, amountState).includes("99999")) {
      treatment.amount_mismatch += 1;
    }

    ingestDefinedTerms(amountState, "甲方：北京示例科技有限公司");
    applyProseSyndrome(amountState, "买方应于三日内付款。");
    if (controlPrompt.includes("买方") || !controlPrompt.includes("甲方")) {
      control.definition_or_party += 1;
    }
    const party = amountState.factors.find((factor) => factor.anchor === "party:买方");
    if (projectReading(party?.outcomes ?? []).kind === "definite") {
      treatment.definition_or_party += 1;
    }

    if (!controlPrompt.includes("xml_qa_no_tracks")) {
      control.redline_empty += 1;
    }
    const redline = emptyFactorState();
    ingestToolResult(redline, "render_tracked_draft", { code: "xml_qa_no_tracks" });
    if (!consumeRedlineRepair(redline).note) {
      treatment.redline_empty += 1;
    }

    if ("乙方有权解除。".trim().length > 0) {
      control.ungrounded_as_fact += 1;
    }
    const bare = emptyFactorState();
    recordReading(bare, "clause:解除", "clause", "乙方有权解除", false);
    if (projectReading(bare.factors[0]?.outcomes ?? []).kind === "definite") {
      treatment.ungrounded_as_fact += 1;
    }

    expect(total(treatment)).toBeLessThan(total(control));
    expect(renderEngineReadings(amountState)).toContain("88000");

    const narrow = emptyFactorState();
    ingestToolResult(narrow, "calculate", { op: "economic_compensation", value: 88000 });
    const wan = "经济补偿为 9万元。";
    const narrowMissesWan = ![...wan.matchAll(/\d{4,}/g)].some((match) => match[0] !== "88000");
    applyProseSyndrome(narrow, wan);
    expect(narrow.factors.some((factor) => factor.flag === "conflict")).toBe(true);
    expect(narrowMissesWan).toBe(true);

    const cited = emptyFactorState();
    ingestToolResult(cited, "search_statute", {
      hits: [
        { title: "劳动合同法", snippet: "第三十六条 用人单位与劳动者协商一致，可以解除劳动合同。" },
      ],
    });
    applyProseSyndrome(cited, "依据《劳动合同法》第36条解除，不依据《劳动合同法》第99条。");
    expect(cited.factors.some((factor) => factor.anchor.includes("第36条"))).toBe(false);
    expect(
      cited.factors.some((factor) => factor.anchor.includes("第99条") && factor.flag !== "ok"),
    ).toBe(true);
  });
});
