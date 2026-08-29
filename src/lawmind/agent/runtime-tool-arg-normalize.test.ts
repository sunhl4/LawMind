import { describe, expect, it } from "vitest";
import type { ToolCallContext } from "../runtime/tool-pipeline.js";
import { normalizeToolCallArguments } from "./runtime-tool-arg-normalize.js";
import type { AgentContext } from "./types.js";

function makeCall(
  toolName: string,
  args: Record<string, unknown>,
  linkedTaskId?: string,
): ToolCallContext {
  return {
    toolCallId: "tc-1",
    toolName,
    args,
    tool: undefined,
    ctx: {
      workspaceDir: "/tmp/ws",
      sessionId: "s1",
      actorId: "lawyer",
      linkedTaskId,
    } satisfies AgentContext,
    turn: { turnId: "turn-1" },
    policy: {
      usedToolCalls: 1,
      maxToolCalls: 16,
      toolTimeoutMs: 30_000,
      strictDangerousToolApproval: false,
      allowDangerousToolsWithoutApproval: true,
      actorId: "lawyer",
      auditDir: "/tmp/ws/audit",
    },
  };
}

describe("normalizeToolCallArguments", () => {
  it("maps path alias to file_path for write_document", () => {
    const call = makeCall("write_document", { path: "notes/foo.md", content: "hi" });
    normalizeToolCallArguments(call);
    expect(call.args.file_path).toBe("notes/foo.md");
    expect(call.args.path).toBeUndefined();
  });

  it("defaults write_document file_path from linkedTaskId when only content given", () => {
    const call = makeCall("write_document", { content: '{"taskId":"t1"}' }, "t1");
    normalizeToolCallArguments(call);
    expect(call.args.file_path).toBe("drafts/t1.json");
  });

  it("defaults update_draft task_id from linkedTaskId", () => {
    const call = makeCall("update_draft", { summary: "new" }, "draft-abc");
    normalizeToolCallArguments(call);
    expect(call.args.task_id).toBe("draft-abc");
  });
});
