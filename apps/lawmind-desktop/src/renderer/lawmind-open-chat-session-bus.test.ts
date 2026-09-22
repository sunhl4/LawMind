import { describe, expect, it } from "vitest";
import { requestOpenChatSession, subscribeOpenChatSession } from "./lawmind-open-chat-session-bus";

describe("requestOpenChatSession", () => {
  it("delivers a safe ref and ignores traversal ids", () => {
    const seen: string[] = [];
    const stop = subscribeOpenChatSession((ref) => {
      seen.push(ref.sessionId);
    });
    requestOpenChatSession({ sessionId: "sess-1", title: "采购合同审查" });
    requestOpenChatSession({ sessionId: "../etc/passwd", title: "坏" });
    stop();
    expect(seen).toEqual(["sess-1"]);
  });
});
