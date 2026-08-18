import { describe, expect, it } from "vitest";
import {
  humanToolLabel,
  humanToolSequenceLabel,
  humanWaitCopyFromUserText,
  inferWaitIntent,
} from "./lawmind-human-wait.js";

describe("lawmind-human-wait", () => {
  it("maps user text to wait intents", () => {
    expect(inferWaitIntent("请对以下合同进行风险审查")).toBe("review");
    expect(inferWaitIntent("请帮我起草一封律师函")).toBe("draft");
    expect(inferWaitIntent("请检索违约责任相关法规")).toBe("research");
    expect(inferWaitIntent("你好")).toBe("general");
  });

  it("uses lawyer-facing wait copy, not tool names", () => {
    expect(humanWaitCopyFromUserText("起草律师函", 1_000)).toBe("正在读你的要求…");
    expect(humanWaitCopyFromUserText("起草律师函", 10_000)).toContain("写这封");
    expect(humanWaitCopyFromUserText("审查合同风险", 10_000)).toContain("审这份");
    expect(humanWaitCopyFromUserText("检索法条", 10_000)).toContain("查这个问题");
    expect(humanWaitCopyFromUserText("起草律师函", 25_000)).toContain("还在写");
    expect(humanWaitCopyFromUserText("起草律师函", 10_000)).not.toMatch(/draft_document|token/i);
  });

  it("maps tool ids to short Chinese verbs", () => {
    expect(humanToolLabel("search_statute")).toBe("查法条");
    expect(humanToolLabel("draft_document")).toBe("起草文书");
    expect(humanToolLabel("unknown_tool")).toBe("处理材料");
    expect(humanToolSequenceLabel(["search_statute", "draft_document"])).toBe("查法条 → 起草文书");
  });
});
