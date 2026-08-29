import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../types.js";
import { describeDraftScaffold } from "./scaffold-status.js";

function draft(sections: ArtifactDraft["sections"]): ArtifactDraft {
  return {
    taskId: "t-scaffold-1",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections,
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  };
}

describe("describeDraftScaffold", () => {
  it("does not treat a finished rental with one todo as a scaffold", () => {
    const view = describeDraftScaffold(
      draft([
        {
          heading: "租金",
          body: `${"甲乙双方就房屋租赁事宜达成如下协议。".repeat(8)}【待补充：押金数额】`,
        },
      ]),
    );
    expect(view.dense).toBe(false);
    expect(view.label).toBe("文中仍有未填项");
  });

  it("flags three scaffold tokens as a dense skeleton draft", () => {
    const view = describeDraftScaffold(
      draft([
        {
          heading: "合同",
          body: "【出租人】【承租人】【房屋地址】",
        },
      ]),
    );
    expect(view.dense).toBe(true);
    expect(view.label).toBe("仍为骨架稿");
    expect(view.hint).toContain("骨架占位");
  });
});
