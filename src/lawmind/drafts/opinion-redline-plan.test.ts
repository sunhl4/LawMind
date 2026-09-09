import { describe, expect, it } from "vitest";
import {
  buildRedlinePlanFromOpinion,
  parseRecommendedWordingEdits,
} from "./opinion-redline-plan.js";

describe("opinion-redline-plan", () => {
  it("parses 「find」→「replace」 from 修改建议", () => {
    const edits = parseRecommendedWordingEdits([
      {
        heading: "修改建议",
        body: "1. 推荐措辞：「无限责任」→「责任上限不超过合同总额的100%」。",
      },
    ]);
    expect(edits).toHaveLength(1);
    expect(edits[0]?.find).toBe("无限责任");
    expect(edits[0]?.replace).toContain("责任上限");
  });

  it("skips placeholders and identical pairs", () => {
    const edits = parseRecommendedWordingEdits([
      {
        heading: "修改建议",
        body: "1. 推荐措辞：【可替换原句】\n2. 「甲」→「甲」",
      },
    ]);
    expect(edits).toHaveLength(0);
  });

  it("normalizes wide spans into plan items or skipped", () => {
    const plan = buildRedlinePlanFromOpinion({
      taskId: "t-op",
      sections: [
        {
          heading: "修改建议",
          body: "原句：「违约金为合同总额的百分之三十」改为「违约金为合同总额的百分之十」。",
        },
      ],
    });
    expect(plan.items.length + plan.skipped.length).toBeGreaterThan(0);
  });
});
