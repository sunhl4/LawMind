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
  it("replaces a finished tool detail when a later preview arrives", () => {
    let blocks = startActivityTool(createEmptyActivity(), {
      toolCallId: "tc-draft",
      toolName: "draft_worker",
    });
    blocks = endActivityTool(blocks, {
      toolCallId: "tc-draft",
      toolName: "draft_worker",
      ok: true,
      resultPreview: "已审查「解除」",
    });
    blocks = endActivityTool(blocks, {
      toolCallId: "tc-draft",
      toolName: "draft_worker",
      ok: true,
      resultPreview: "已审查「解除」（读 2 步）",
    });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe("tool");
    if (blocks[0]?.kind === "tool") {
      expect(blocks[0].detail).toContain("读 2 步");
      expect(blocks[0].status).toBe("done");
    }
  });

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

  it("does not mark an internal delivery retry as a failed step", () => {
    let blocks = startActivityTool(createEmptyActivity(), {
      toolCallId: "tc-xml",
      toolName: "render_tracked_draft",
    });
    blocks = endActivityTool(blocks, {
      toolCallId: "tc-xml",
      toolName: "render_tracked_draft",
      ok: false,
      error:
        "【同一回合验收未过】验证器未绿，本回合不得结束。请立即调用 render_tracked_draft。\n- [xml_qa_fail] 导出文件的 XML 未见审阅痕迹",
    });
    const tool = blocks[0];
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(tool.status).toBe("done");
      expect(tool.detail).toBe("正在写成审阅稿。");
      expect(tool.detail).not.toContain("XML");
      expect(tool.detail).not.toContain("请重导");
    }
  });

  it("keeps search result preview and session chips on success", () => {
    let blocks = startActivityTool(createEmptyActivity(), {
      toolCallId: "tc-2",
      toolName: "search_conversations",
      args: { query: "合同审查" },
    });
    blocks = endActivityTool(blocks, {
      toolCallId: "tc-2",
      toolName: "search_conversations",
      ok: true,
      resultPreview: "命中 1 条：采购合同审查",
      sessionRefs: [{ sessionId: "s1", title: "采购合同审查" }],
    });
    const tool = blocks[0];
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(tool.status).toBe("done");
      expect(tool.detail).toBe("命中 1 条：采购合同审查");
      expect(tool.sessionRefs).toEqual([{ sessionId: "s1", title: "采购合同审查" }]);
    }
  });

  it("rebuilds session chips from persisted liveTrace", () => {
    const blocks = resolveMessageActivity({
      liveTrace: {
        active: false,
        steps: [
          {
            id: "tc-9",
            kind: "tool",
            label: "检索其他对话",
            status: "done",
            detail: "命中 1 条",
            sessionRefs: [{ sessionId: "s9", title: "旧审查", assistantId: "asst-9" }],
          },
        ],
      },
    });
    expect(blocks[0]?.kind).toBe("tool");
    if (blocks[0]?.kind === "tool") {
      expect(blocks[0].sessionRefs).toEqual([
        { sessionId: "s9", title: "旧审查", assistantId: "asst-9" },
      ]);
    }
  });
});
