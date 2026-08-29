import { describe, expect, it } from "vitest";
import {
  buildClarificationAction,
  buildRequiresActionsFromTurn,
  buildToolApprovalAction,
  formatClarificationResumeMessage,
  toolDisplayNameZh,
} from "./requires-action.js";

describe("requires-action", () => {
  it("toolDisplayNameZh maps known tools in lawyer Chinese", () => {
    expect(toolDisplayNameZh("execute_workflow")).toBe("启动办案流程");
    expect(toolDisplayNameZh("write_document")).toBe("审定文书");
    expect(toolDisplayNameZh("unknown_tool")).toBe("该项操作");
  });

  it("buildToolApprovalAction includes approve and reject", () => {
    const a = buildToolApprovalAction({
      sessionId: "s1",
      matterId: "m1",
      taskId: "t1",
      toolName: "render_document",
      toolCallId: "tc1",
      toolArgs: { task_id: "x" },
    });
    expect(a.kind).toBe("tool_approval");
    expect(a.decisions).toContain("approve");
    expect(a.title).toContain("Word");
    expect(a.title).not.toMatch(/render_document/);
  });

  it("buildRequiresActionsFromTurn for clarification", () => {
    const list = buildRequiresActionsFromTurn({
      status: "awaiting_clarification",
      sessionId: "s1",
      turnId: "turn1",
      clarificationQuestions: [{ key: "k1", question: "合同金额？" }],
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe("clarification");
  });

  it("formatClarificationResumeMessage skips empty answers", () => {
    const msg = formatClarificationResumeMessage({ k1: "100万", k2: "" }, [
      { key: "k1", question: "金额？" },
      { key: "k2", question: "期限？" },
    ]);
    expect(msg).toContain("100万");
    expect(msg).not.toContain("期限？");
  });

  it("buildRequiresActionsFromTurn for paused tool-budget checkpoint", () => {
    const list = buildRequiresActionsFromTurn({
      status: "paused",
      sessionId: "s1",
      turnId: "turn1",
      toolCallsExecuted: 40,
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.kind).toBe("continue_tools");
    expect(list[0]?.toolCallsExecuted).toBe(40);
    expect(list[0]?.summary).toContain("40");
    expect(list[0]?.decisions).toEqual(["approve", "reject"]);
  });

  it("adds escalate recommendation for outbound mail and never marks readyToUse", () => {
    for (const toolName of ["send_email", "prepare_outbound_mail"] as const) {
      const a = buildToolApprovalAction({
        sessionId: "s1",
        toolName,
        toolCallId: "tc1",
        toolArgs: { to: "client@example.com" },
      });
      expect(a.recommendation).toBe("先核对收件人再发");
      expect(a.readyToUse).toBe(false);
      expect(a.riskFlags).toContain("outbound");
      expect(a.decisions).toEqual(["approve", "reject"]);
    }
  });

  it("does not attach outbound escalate fields to other tools", () => {
    const a = buildToolApprovalAction({
      sessionId: "s1",
      toolName: "render_document",
      toolCallId: "tc1",
      toolArgs: { task_id: "x" },
    });
    expect(a.recommendation).toBeUndefined();
    expect(a.readyToUse).toBeUndefined();
  });

  it("buildClarificationAction for status-only awaiting", () => {
    const a = buildClarificationAction({
      sessionId: "s1",
      questions: [],
    });
    expect(a.summary).toContain("补充");
  });
});
