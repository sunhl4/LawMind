import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { pickLatestScaffoldDraft, scaffoldChatBannerText } from "./lawmind-scaffold-copy";

function draft(partial: Partial<ArtifactDraft>): ArtifactDraft {
  return {
    taskId: "t1",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections: [{ heading: "合同", body: "完整正文没有占位。" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("scaffold chat copy", () => {
  it("picks the newest pending dense scaffold", () => {
    const picked = pickLatestScaffoldDraft([
      draft({
        taskId: "dense",
        title: "骨架",
        sections: [{ heading: "合同", body: "【出租人】【承租人】【房屋地址】" }],
      }),
      draft({ taskId: "ready", title: "成稿" }),
    ]);
    expect(picked?.taskId).toBe("dense");
    expect(scaffoldChatBannerText("骨架")).toContain("骨架稿");
  });

  it("ignores approved drafts", () => {
    expect(
      pickLatestScaffoldDraft([
        draft({
          reviewStatus: "approved",
          sections: [{ heading: "合同", body: "【出租人】【承租人】【房屋地址】" }],
        }),
      ]),
    ).toBeNull();
  });
});
