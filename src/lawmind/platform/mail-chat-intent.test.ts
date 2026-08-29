import { describe, expect, it } from "vitest";
import { detectMailChatIntent, isProductMetaAsk } from "./mail-chat-intent.js";

describe("mail-chat-intent", () => {
  it("detects product meta asks", () => {
    expect(isProductMetaAsk("过程卡在了哪里然后修正我们的软件")).toBe(true);
    expect(detectMailChatIntent("请查一下卡在哪里")?.kind).toBe("meta");
  });

  it("detects mail-contract-review from free chat", () => {
    const hit = detectMailChatIntent("去邮箱读附件按邮件指示做合同审阅改稿");
    expect(hit?.kind).toBe("mail-contract-review");
    expect(hit?.presetId).toBe("mail-contract-review");
  });

  it("detects mail-inbox-digest", () => {
    const hit = detectMailChatIntent("整理一下邮箱收件");
    expect(hit?.kind).toBe("mail-inbox-digest");
  });

  it("ignores ordinary legal chat", () => {
    expect(detectMailChatIntent("帮我看法条关于合同解除")).toBeNull();
  });
});
