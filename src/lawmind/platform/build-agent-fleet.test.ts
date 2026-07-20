import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerDelegation } from "../agent/collaboration/delegation-registry.js";
import { createSession, saveSession } from "../agent/session.js";
import { persistDraft } from "../drafts/index.js";
import { buildAgentFleetSummary } from "./build-agent-fleet.js";

describe("buildAgentFleetSummary", () => {
  let workspaceDir = "";

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("aggregates chat, delegation, and approval runs", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-"));
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.pendingRequiresAction = [
      {
        id: "ra-1",
        kind: "tool_approval",
        threadId: "t1",
        title: "待批准",
        summary: "test",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    saveSession(workspaceDir, session);

    registerDelegation({
      workspaceDir,
      fromAssistantId: "default",
      toAssistantId: "research",
      task: "检索类案",
      matterId: "matter-1",
    });
    persistDraft(workspaceDir, {
      taskId: "draft-1",
      matterId: "matter-1",
      title: "待审法律意见书",
      output: "docx",
      templateId: "general",
      summary: "待律师审核",
      sections: [],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: new Date().toISOString(),
    });

    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      jobs: [
        {
          jobId: "job-1",
          status: "running",
          matterId: "matter-1",
          templateId: "nda-review",
          createdAt: new Date().toISOString(),
          progress: { totalSteps: 3, completedSteps: 1, runningStepIds: ["s2"] },
        },
      ],
    });

    expect(fleet.runs.some((r) => r.kind === "chat")).toBe(true);
    expect(fleet.runs.some((r) => r.kind === "delegation")).toBe(true);
    expect(fleet.runs.some((r) => r.kind === "workflow_job")).toBe(true);
    expect(
      fleet.runs.some(
        (r) =>
          r.kind === "pending_review" && r.status === "awaiting_review" && r.taskId === "draft-1",
      ),
    ).toBe(true);
    expect(fleet.counts.total).toBeGreaterThanOrEqual(4);
  });
});
