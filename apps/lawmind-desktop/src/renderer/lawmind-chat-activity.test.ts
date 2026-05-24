import { describe, expect, it } from "vitest";
import {
  appendActivityDelta,
  appendActivityToolProgress,
  createEmptyActivity,
  endActivityTool,
  resolveMessageActivity,
  startActivityTool,
  textFromActivity,
} from "./lawmind-chat-activity.js";

describe("lawmind-chat-activity", () => {
  it("interleaves model text and tool blocks", () => {
    let blocks = createEmptyActivity();
    blocks = appendActivityDelta(blocks, "我先检索相关条款。");
    blocks = startActivityTool(blocks, { toolCallId: "tc-1", toolName: "research_task" });
    blocks = appendActivityToolProgress(blocks, { toolCallId: "tc-1", label: "检索法规库" });
    blocks = endActivityTool(blocks, {
      toolCallId: "tc-1",
      toolName: "research_task",
      ok: true,
    });
    blocks = appendActivityDelta(blocks, "\n\n结论如下。");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.kind).toBe("text");
    expect(blocks[1]?.kind).toBe("tool");
    expect(blocks[2]?.kind).toBe("text");
    expect(textFromActivity(blocks)).toContain("结论如下");
  });

  it("resolveMessageActivity prefers activity over liveTrace", () => {
    const blocks = resolveMessageActivity({
      activity: [{ id: "t1", kind: "text", content: "hello" }],
      liveTrace: {
        active: false,
        steps: [{ id: "s1", kind: "tool", label: "工具", status: "done" }],
      },
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("text");
  });
});
