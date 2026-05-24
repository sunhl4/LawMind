import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveSession } from "../agent/session.js";
import type { AgentSession } from "../agent/types.js";
import { listPendingToolApprovals } from "./pending-tool-approvals.js";

describe("listPendingToolApprovals", () => {
  it("lists tool_approval from session pendingRequiresAction", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pending-tool-"));
    const now = new Date().toISOString();
    const session: AgentSession = {
      sessionId: "s-pending",
      matterId: "matter-a",
      conversationHistory: [],
      turns: [],
      pendingRequiresAction: [
        {
          id: "ra-1",
          kind: "tool_approval",
          threadId: "t:1",
          title: "待批准：执行工作流",
          summary: "需要确认",
          toolName: "execute_workflow",
          toolArgs: { workflowId: "wf-1" },
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    saveSession(ws, session);
    const items = listPendingToolApprovals(ws, { matterId: "matter-a" });
    expect(items).toHaveLength(1);
    expect(items[0]?.toolName).toBe("execute_workflow");
    expect(items[0]?.sessionId).toBe("s-pending");
  });
});
