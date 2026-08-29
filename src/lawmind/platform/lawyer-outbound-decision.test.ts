import { describe, expect, it } from "vitest";
import {
  isLawyerOutboundDecision,
  isOutboundAutomationContext,
  isOutboundToolName,
  normalizeOutboundRecipient,
  toolRequiresLawyerPause,
  workflowTemplateIsOutbound,
} from "./lawyer-outbound-decision.js";

describe("lawyer-outbound-decision", () => {
  it("treats send_email / pendingSend as 拍板", () => {
    expect(isOutboundToolName("send_email")).toBe(true);
    expect(isOutboundToolName("prepare_outbound_mail")).toBe(true);
    expect(isOutboundToolName("draft_document")).toBe(false);
    expect(toolRequiresLawyerPause("send_email")).toBe(true);
    expect(toolRequiresLawyerPause("prepare_outbound_mail")).toBe(false);
    expect(toolRequiresLawyerPause("render_document")).toBe(false);
    expect(normalizeOutboundRecipient("Counsel <Opp@Firm.CN>")).toBe("opp@firm.cn");
    expect(normalizeOutboundRecipient("opp@firm.cn")).toBe("opp@firm.cn");
    expect(normalizeOutboundRecipient("not-an-email")).toBe("");
    expect(isLawyerOutboundDecision({ kind: "automation_send", status: "awaiting_approval" })).toBe(
      true,
    );
    expect(
      isLawyerOutboundDecision({
        kind: "tool_approval",
        actionKind: "tool_approval",
        toolName: "send_email",
      }),
    ).toBe(true);
  });

  it("does not treat internal drafts / continue_tools as 拍板", () => {
    expect(isLawyerOutboundDecision({ kind: "pending_review", status: "awaiting_review" })).toBe(
      false,
    );
    expect(
      isLawyerOutboundDecision({
        kind: "chat",
        status: "awaiting_approval",
        actionKind: "continue_tools",
      }),
    ).toBe(false);
    expect(
      isLawyerOutboundDecision({
        kind: "tool_approval",
        actionKind: "tool_approval",
        toolName: "draft_document",
      }),
    ).toBe(false);
    expect(isLawyerOutboundDecision({ kind: "queue_item", status: "queued" })).toBe(false);
  });

  it("flags outbound automations and workflow templates", () => {
    expect(isOutboundAutomationContext({ presetId: "mail-contract-review" })).toBe(true);
    expect(isOutboundAutomationContext({ presetId: "client-weekly-update" })).toBe(true);
    expect(isOutboundAutomationContext({ presetId: "renewal-monitor" })).toBe(false);
    expect(isOutboundAutomationContext({ presetId: "custom", notifyEmail: "a@firm.com" })).toBe(
      true,
    );
    expect(
      isOutboundAutomationContext({
        presetId: "custom",
        instruction: "改完稿发给客户",
      }),
    ).toBe(true);
    expect(workflowTemplateIsOutbound({ id: "mail-contract-redline" })).toBe(true);
    expect(workflowTemplateIsOutbound({ id: "client-update-memo" })).toBe(true);
    expect(
      workflowTemplateIsOutbound({
        id: "custom-send",
        preApproveToolNames: ["prepare_outbound_mail"],
      }),
    ).toBe(true);
    expect(
      workflowTemplateIsOutbound({
        id: "demo",
        description: "内部整理",
        steps: [{ task: "起草备忘" }],
      }),
    ).toBe(false);
  });

  it("keeps clarification so the agent is not silently stuck", () => {
    expect(isLawyerOutboundDecision({ kind: "chat", status: "awaiting_clarification" })).toBe(true);
    expect(isLawyerOutboundDecision({ actionKind: "clarification" })).toBe(true);
  });
});
