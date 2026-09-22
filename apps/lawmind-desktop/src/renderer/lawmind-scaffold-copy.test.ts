import { describe, expect, it } from "vitest";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { pickLatestScaffoldDraft, scaffoldChatBannerText } from "./lawmind-scaffold-copy";

function draft(partial: Partial<ArtifactDraft> = {}): ArtifactDraft {
  return {
    taskId: "t-scaf",
    title: "房屋租赁合同",
    output: "docx",
    templateId: "word/contract-default",
    deliverableType: "contract.rental",
    summary: "测",
    sections: [{ heading: "合同", body: "【出租人】【承租人】【房屋地址】" }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe("lawmind-scaffold-copy", () => {
  it("picks the latest pending dense scaffold", () => {
    expect(pickLatestScaffoldDraft([draft({ reviewStatus: "approved" })])).toBeNull();
    expect(pickLatestScaffoldDraft([draft()])?.taskId).toBe("t-scaf");
  });

  it("keeps chat banner honest", () => {
    expect(scaffoldChatBannerText("租赁合同")).toContain("骨架稿");
  });
});
