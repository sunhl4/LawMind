import { describe, expect, it } from "vitest";
import {
  applyPendingTurnPlan,
  attachTurnPlanToLastAssistant,
  formatTurnPlanWorldState,
  formatTurnPlanExecuteText,
  isTurnPlanComplete,
  parseAgentTurnPlan,
  promotePendingTurnPlan,
  pruneTurnPlanForNewInstruction,
  summarizeUpdatePlanResultForHistory,
  turnPlanProgress,
  validateUpdatePlanArgs,
  withUpdatePlanControlTool,
  type AgentTurnPlan,
} from "./turn-plan.js";
import { wrapWorldStateSection } from "./world-state.js";

function samplePlan(overrides?: Partial<AgentTurnPlan>): AgentTurnPlan {
  return {
    items: [
      { step: "读钉选合同", status: "completed" },
      { step: "标风险条款", status: "in_progress" },
      { step: "给出修订建议", status: "pending" },
    ],
    updatedAt: "2026-09-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("validateUpdatePlanArgs", () => {
  it("accepts a 3-step Codex-shaped plan", () => {
    const result = validateUpdatePlanArgs({
      explanation: "先核主体再改违约",
      plan: [
        { step: "核对主体与效力", status: "in_progress" },
        { step: "审违约与责任上限", status: "pending" },
        { step: "给出可落改建议", status: "pending" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.items).toHaveLength(3);
      expect(result.plan.explanation).toContain("先核主体");
      expect(result.plan.items[0]?.status).toBe("in_progress");
    }
  });

  it("accepts Chinese status aliases", () => {
    const result = validateUpdatePlanArgs({
      plan: [
        { step: "读合同", status: "已完成" },
        { step: "标风险", status: "进行中" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.items.map((i) => i.status)).toEqual(["completed", "in_progress"]);
    }
  });

  it("rejects two in_progress steps", () => {
    const result = validateUpdatePlanArgs({
      plan: [
        { step: "一步", status: "in_progress" },
        { step: "二步", status: "in_progress" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("in_progress");
    }
  });

  it("rejects a 1-step list", () => {
    const result = validateUpdatePlanArgs({
      plan: [{ step: "只做一件事", status: "in_progress" }],
    });
    expect(result.ok).toBe(false);
  });

  it("allows all-completed with zero in_progress", () => {
    const result = validateUpdatePlanArgs({
      plan: [
        { step: "读完", status: "completed" },
        { step: "写完", status: "completed" },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("turn-plan world-state", () => {
  it("renders compact XML rather than an essay", () => {
    const xml = formatTurnPlanWorldState(samplePlan({ explanation: "改顺序" }));
    expect(xml).toContain("<turn_plan");
    expect(xml).toContain('status="completed"');
    expect(xml).toContain("读钉选合同");
    expect(xml).not.toContain("自主工作流程");
  });

  it("patches session world-state from pendingTurnPlan", () => {
    const session = {
      conversationHistory: [
        {
          role: "system",
          content: wrapWorldStateSection("permission", "<environment/>"),
        },
      ],
      worldStateEpoch: 0,
    };
    const ctx: { pendingTurnPlan?: AgentTurnPlan } = { pendingTurnPlan: samplePlan() };
    expect(applyPendingTurnPlan(session, ctx)).toBe(true);
    expect(ctx.pendingTurnPlan).toBeUndefined();
    expect(session.turnPlan?.items).toHaveLength(3);
    expect(session.conversationHistory[0]?.content).toContain("<!--lm-ws:plan-->");
    expect(session.worldStateEpoch).toBe(1);
  });

  it("promotes a nested tool result onto shared ctx", () => {
    const ctx: { pendingTurnPlan?: AgentTurnPlan } = {};
    const plan = samplePlan();
    expect(promotePendingTurnPlan(ctx, { message: "清单已更新", plan })).toEqual(plan);
    expect(ctx.pendingTurnPlan).toEqual(plan);
  });
});

describe("pruneTurnPlanForNewInstruction", () => {
  it("clears a completed plan on a fresh instruction", () => {
    const done = samplePlan({
      items: [
        { step: "a", status: "completed" },
        { step: "b", status: "completed" },
      ],
    });
    expect(pruneTurnPlanForNewInstruction(done, "帮我再看另一份合同")).toBeUndefined();
  });

  it("keeps an incomplete plan and checkpoint resumes", () => {
    const open = samplePlan();
    expect(pruneTurnPlanForNewInstruction(open, "继续把风险写进意见")?.items).toHaveLength(3);
    const done = samplePlan({
      items: [
        { step: "a", status: "completed" },
        { step: "b", status: "completed" },
      ],
    });
    expect(pruneTurnPlanForNewInstruction(done, "【从检查点继续】律师同意继续本轮。")).toEqual(
      done,
    );
  });
});

describe("helpers", () => {
  it("reports progress and completion", () => {
    expect(turnPlanProgress(samplePlan())).toEqual({ completed: 1, total: 3 });
    expect(isTurnPlanComplete(samplePlan())).toBe(false);
  });

  it("parses nested tool result payloads", () => {
    const plan = parseAgentTurnPlan({
      message: "清单已更新",
      plan: samplePlan(),
    });
    expect(plan?.items[1]?.step).toBe("标风险条款");
  });

  it("attaches the live plan onto the last assistant bubble", () => {
    const session = {
      turnPlan: samplePlan(),
      conversationHistory: [{ role: "user" as const }, { role: "assistant" as const }],
    };
    attachTurnPlanToLastAssistant(session);
    expect(session.conversationHistory[1]?.turnPlan?.items).toHaveLength(3);
  });

  it("history receipt omits the checklist body", () => {
    const slim = summarizeUpdatePlanResultForHistory({
      ok: true,
      data: { message: "清单已更新（1/3）", plan: samplePlan() },
    });
    expect(slim).toEqual({ ok: true, data: { message: "清单已更新（1/3）" } });
    expect(JSON.stringify(slim)).not.toContain("读钉选合同");
  });

  it("formats execute text without skipped steps", () => {
    const text = formatTurnPlanExecuteText(samplePlan(), new Set([1]));
    expect(text).toContain("实施步骤");
    expect(text).toContain("读钉选合同");
    expect(text).toContain("给出修订建议");
    expect(text).toContain("已跳过：标风险条款");
    expect(text).not.toMatch(/^2\. 标风险条款/m);
  });

  it("formats execute text with lawyer-edited step labels", () => {
    const text = formatTurnPlanExecuteText(samplePlan(), new Set(), [
      "先读主合同",
      "标风险条款",
      "给出修订建议",
    ]);
    expect(text).toContain("1. 先读主合同");
    expect(text).not.toContain("读钉选合同");
  });

  it("pierces non-empty allowlists but leaves empty locks empty", () => {
    expect(withUpdatePlanControlTool(["analyze_document"])).toEqual([
      "analyze_document",
      "update_plan",
    ]);
    expect(withUpdatePlanControlTool([])).toEqual([]);
    expect(withUpdatePlanControlTool(undefined)).toBeUndefined();
  });
});
