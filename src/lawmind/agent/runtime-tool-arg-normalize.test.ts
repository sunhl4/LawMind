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

  it("defaults write_document to workspace notes/ when no path and no linked draft", () => {
    const call = makeCall("write_document", { content: "备忘" });
    normalizeToolCallArguments(call);
    expect(String(call.args.file_path)).toMatch(/^notes\/工作笔记_\d{8}_01\.md$/);
  });

  it("defaults write_document to the matter notes/ folder", () => {
    const call = makeCall("write_document", { content: "备忘" });
    call.ctx.matterId = "xinghui-sale-876";
    normalizeToolCallArguments(call);
    expect(String(call.args.file_path)).toMatch(
      /^cases\/xinghui-sale-876\/notes\/工作笔记_\d{8}_01\.md$/,
    );
  });

  it("defaults update_draft task_id from linkedTaskId", () => {
    const call = makeCall("update_draft", { summary: "new" }, "draft-abc");
    normalizeToolCallArguments(call);
    expect(call.args.task_id).toBe("draft-abc");
  });

  it("coerces update_plan JSON-string plan and items alias", () => {
    const asString = makeCall("update_plan", {
      plan: JSON.stringify([
        { step: "读合同", status: "in_progress" },
        { step: "标风险", status: "pending" },
      ]),
    });
    normalizeToolCallArguments(asString);
    expect(Array.isArray(asString.args.plan)).toBe(true);
    expect((asString.args.plan as unknown[]).length).toBe(2);

    const aliased = makeCall("update_plan", {
      items: [
        { step: "读合同", status: "in_progress" },
        { step: "标风险", status: "pending" },
      ],
    });
    normalizeToolCallArguments(aliased);
    expect(Array.isArray(aliased.args.plan)).toBe(true);
  });
});
