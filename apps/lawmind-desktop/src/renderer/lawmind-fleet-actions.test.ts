import { describe, expect, it } from "vitest";
import {
  collectFleetActions,
  flattenWorkspaceChatActions,
  matterApprovalsToActions,
} from "./lawmind-fleet-actions";
import type { LawMindRequiresAction } from "./lawmind-requires-action";

describe("lawmind-fleet-actions", () => {
  it("flattens workspace chat actions with sessionId", () => {
    const flat = flattenWorkspaceChatActions({
      chatRequiresActions: [
        {
          sessionId: "s1",
          actions: [
            {
              id: "a1",
              kind: "clarification",
              threadId: "t",
              title: "补充",
              summary: "x",
              createdAt: "2026-01-01T00:00:00.000Z",
            } as LawMindRequiresAction,
          ],
        },
      ],
    } as never);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.sessionId).toBe("s1");
  });

  it("maps only pending matter approvals", () => {
    const rows = matterApprovalsToActions([
      {
        approvalId: "ap1",
        matterId: "m1",
        requestedBy: "lawyer",
        reason: "外发",
        riskLevel: "medium",
        status: "pending",
        requestedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        approvalId: "ap2",
        matterId: "m1",
        requestedBy: "lawyer",
        reason: "已批",
        riskLevel: "low",
        status: "approved",
        requestedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("matter_approval");
    expect(rows[0]?.id).toBe("ap1");
  });

  it("scopes chat pool to current session and always includes matter approvals", () => {
    const runActions: LawMindRequiresAction[] = [
      {
        id: "run-1",
        kind: "tool_approval",
        threadId: "t",
        title: "工具",
        summary: "y",
        sessionId: "s-cur",
        createdAt: "2026-01-01T00:00:00.000Z",
      } as LawMindRequiresAction,
    ];
    const out = collectFleetActions({
      summary: {
        chatRequiresActions: [
          {
            sessionId: "s-cur",
            title: "会话",
            actions: [
              {
                id: "ws-1",
                kind: "clarification",
                threadId: "t",
                title: "补充",
                summary: "z",
                createdAt: "2026-01-01T00:00:00.000Z",
              } as LawMindRequiresAction,
            ],
          },
          {
            sessionId: "other",
            title: "其他会话",
            actions: [
              {
                id: "ws-other",
                kind: "clarification",
                threadId: "t",
                title: "其他",
                summary: "o",
                createdAt: "2026-01-01T00:00:00.000Z",
              } as LawMindRequiresAction,
            ],
          },
        ],
        approvals: [
          {
            approvalId: "ap1",
            matterId: "m1",
            requestedBy: "lawyer",
            reason: "外发",
            riskLevel: "medium",
            status: "pending",
            requestedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      } as never,
      currentSessionId: "s-cur",
      shellSessionId: "s-cur",
      runActions,
      sessionRequiresActions: [
        {
          id: "shell-1",
          kind: "tool_approval",
          threadId: "t",
          title: "壳",
          summary: "s",
          createdAt: "2026-01-01T00:00:00.000Z",
        } as LawMindRequiresAction,
      ],
    });
    const ids = out.map((a) => a.id);
    expect(ids).toContain("run-1");
    expect(ids).toContain("ws-1");
    expect(ids).toContain("shell-1");
    expect(ids).toContain("ap1");
    expect(ids).not.toContain("ws-other");
  });
});
