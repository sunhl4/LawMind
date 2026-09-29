import { describe, expect, it } from "vitest";
import { statuteJumpUrl, tryConsumeLawyerChatLink } from "./lawyer-chat-link.js";

describe("lawyer chat links", () => {
  it("opens a draft from its title", () => {
    const hit = tryConsumeLawyerChatLink("见 [驾驶员劳务派遣协议](lm-draft:task-1) 的稿。", 2);
    expect(hit?.link).toEqual({
      kind: "draft",
      label: "驾驶员劳务派遣协议",
      taskId: "task-1",
    });
  });

  it("opens a statute when the label names the article", () => {
    const href = "https://flk.npc.gov.cn/detail/labor-63";
    expect(statuteJumpUrl(href, "《劳动合同法》第63条")).toBe(href);
    const hit = tryConsumeLawyerChatLink(`[《劳动合同法》第63条](${href})`, 0);
    expect(hit?.link.kind).toBe("statute");
    if (hit?.link.kind === "statute") {
      expect(hit.link.url).toBe("https://flk.npc.gov.cn/detail/labor-63");
    }
  });

  it("does not turn a random https link into a button", () => {
    const hit = tryConsumeLawyerChatLink("[点此登录](https://evil.example/phish)", 0);
    expect(hit?.link).toEqual({ kind: "plain", label: "点此登录" });
  });

  it("rejects private hosts even when the label looks like a statute", () => {
    expect(statuteJumpUrl("https://127.0.0.1/a", "《劳动合同法》第63条")).toBeNull();
    expect(statuteJumpUrl("https://user:pass@pkulaw.com/a", "《劳动合同法》第63条")).toBeNull();
    expect(statuteJumpUrl("http://flk.npc.gov.cn/a", "《劳动合同法》第63条")).toBeNull();
  });

  it("allows a legal host even without a book-title label", () => {
    expect(statuteJumpUrl("https://www.pkulaw.com/chl/x", "同工同酬")).toContain("pkulaw.com");
  });
});
