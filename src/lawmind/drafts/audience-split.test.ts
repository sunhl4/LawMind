import { describe, expect, it } from "vitest";
import {
  formatAudienceSplitPromptBlock,
  inferDraftAudience,
  shouldInjectAudienceSplit,
} from "./audience-split.js";

describe("audience-split", () => {
  it("defaults to internal and splits court/client from the instruction", () => {
    expect(inferDraftAudience("请审查采购合同违约责任")).toBe("internal");
    expect(inferDraftAudience("写起诉状")).toBe("court");
    expect(inferDraftAudience("给客户一份审查意见")).toBe("client");
    expect(formatAudienceSplitPromptBlock("internal")).toContain("对内底稿");
    expect(formatAudienceSplitPromptBlock("client")).toContain("给客户");
  });

  it("skips mail and Word tracked redline", () => {
    expect(shouldInjectAudienceSplit({ id: "letter.draft", pipeline: "execute_workflow" })).toBe(
      true,
    );
    expect(shouldInjectAudienceSplit({ id: "mail.contract", pipeline: "tracked_redline" })).toBe(
      false,
    );
    expect(shouldInjectAudienceSplit({ id: "contract.review", pipeline: "tracked_redline" })).toBe(
      false,
    );
  });
});
