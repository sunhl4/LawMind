import { describe, expect, it } from "vitest";
import {
  chatThreadDecisionActions,
  parseRequiresActionsFromResponse,
} from "./lawmind-requires-action";

describe("parseRequiresActionsFromResponse", () => {
  it("parses valid requiresAction array", () => {
    const raw = [
      {
        id: "a1",
        kind: "tool_approval",
        threadId: "m:t:s",
        title: "批准",
        summary: "执行工具",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const out = parseRequiresActionsFromResponse(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("tool_approval");
  });

  it("returns empty for invalid entries", () => {
    expect(parseRequiresActionsFromResponse([{ id: 1 }])).toHaveLength(0);
    expect(parseRequiresActionsFromResponse(null)).toHaveLength(0);
  });
});

describe("chatThreadDecisionActions", () => {
  it("keeps continue, outbound, and clarification in the thread", () => {
    const out = chatThreadDecisionActions([
      {
        id: "c1",
        kind: "continue_tools",
        threadId: "t",
        title: "本轮步骤较多",
        summary: "已经办理 31 步",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m1",
        kind: "tool_approval",
        threadId: "t",
        title: "外发",
        summary: "发信",
        toolName: "send_email",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "w1",
        kind: "tool_approval",
        threadId: "t",
        title: "流程",
        summary: "执行",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(out.map((a) => a.id)).toEqual(["c1", "m1"]);
  });

  it("keeps a delivery continue card in the thread so 点继续 is a real button", () => {
    const out = chatThreadDecisionActions([
      {
        id: "budget",
        kind: "continue_tools",
        threadId: "t",
        title: "本轮步骤较多",
        summary: "已经办理 31 步",
        trigger: "step_budget",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "delivery",
        kind: "continue_tools",
        threadId: "t",
        title: "稿还没交完",
        summary: "点继续，接着把这份稿做完。",
        trigger: "delivery",
        instruction: "按批注改合作协议并出审阅稿",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(out.map((a) => a.id)).toEqual(["budget", "delivery"]);
  });

  it("keeps an interrupted-turn card and the gate-stop notice in the thread", () => {
    const out = chatThreadDecisionActions([
      {
        id: "budget",
        kind: "continue_tools",
        threadId: "t",
        title: "本轮步骤较多",
        summary: "已经办理 31 步",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "interrupted:turn-1",
        kind: "continue_tools",
        threadId: "t",
        title: "上一轮被中断",
        summary: "继续本件，还是先弃办？",
        trigger: "interrupted",
        decisions: ["approve", "reject"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "gate",
        kind: "workflow_blocked",
        threadId: "t",
        title: "稿件缺口待您过目",
        summary: "独立审稿已 2 轮未过",
        decisions: ["respond"],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(out.map((a) => a.id)).toEqual(["budget", "interrupted:turn-1", "gate"]);
  });
});
