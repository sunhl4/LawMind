import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  markDelegationCompleted,
  registerDelegation,
} from "../agent/collaboration/delegation-registry.js";
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

    const delegation = registerDelegation({
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

    // In-memory delegation registry is process-global; close so later tests stay isolated.
    markDelegationCompleted(workspaceDir, delegation.delegationId, "done");
  });

  it("filters runs by matterId and applies assistantLabels", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-matter-"));
    const keep = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "research",
      matterId: "matter-keep",
    });
    keep.pendingRequiresAction = [
      {
        id: "ra-keep",
        kind: "tool_approval",
        threadId: "t1",
        title: "待批准",
        summary: "x",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    saveSession(workspaceDir, keep);

    const drop = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-drop",
    });
    drop.pendingRequiresAction = [
      {
        id: "ra-drop",
        kind: "tool_approval",
        threadId: "t2",
        title: "待批准",
        summary: "y",
        toolName: "write_document",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    saveSession(workspaceDir, drop);

    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      matterId: "matter-keep",
      assistantLabels: { research: "研究员" },
      jobs: [
        {
          jobId: "job-keep",
          status: "running",
          matterId: "matter-keep",
          templateId: "nda-review",
          createdAt: new Date().toISOString(),
        },
        {
          jobId: "job-drop",
          status: "running",
          matterId: "matter-drop",
          templateId: "other",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(fleet.runs.every((r) => r.matterId === "matter-keep")).toBe(true);
    expect(fleet.runs.some((r) => r.jobId === "job-drop")).toBe(false);
    const chat = fleet.runs.find((r) => r.kind === "chat");
    expect(chat?.assigneeLabel).toBe("研究员");
  });

  it("respects limit and sorts awaiting_approval ahead of queued jobs", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-limit-"));
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-limit",
    });
    session.pendingRequiresAction = [
      {
        id: "ra-limit",
        kind: "tool_approval",
        threadId: "t1",
        title: "待批准",
        summary: "x",
        toolName: "execute_workflow",
        decisions: ["approve", "reject"],
        createdAt: new Date().toISOString(),
      },
    ];
    saveSession(workspaceDir, session);

    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      limit: 1,
      jobs: [
        {
          jobId: "job-queued",
          status: "queued",
          matterId: "matter-limit",
          templateId: "queued-job",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(fleet.runs).toHaveLength(1);
    expect(fleet.counts.total).toBe(1);
    expect(fleet.runs[0]?.status).toBe("awaiting_approval");
    expect(fleet.runs[0]?.kind).toBe("chat");
  });

  it("skips idle chats and completed jobs", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-idle-"));
    createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-idle",
    });
    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      jobs: [
        {
          jobId: "done",
          status: "completed",
          matterId: "matter-idle",
          templateId: "done",
          createdAt: new Date().toISOString(),
        },
        {
          jobId: "cancelled",
          status: "cancelled",
          matterId: "matter-idle",
          templateId: "cancelled",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(fleet.runs).toHaveLength(0);
    expect(fleet.counts.total).toBe(0);
  });

  it("surfaces clarification-pending chat and scheduled/failed job statuses", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-clarify-"));
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-clarify",
    });
    session.pendingClarificationKeys = ["parties"];
    saveSession(workspaceDir, session);

    persistDraft(workspaceDir, {
      taskId: "draft-mod",
      matterId: "matter-clarify",
      title: "修改后草稿",
      output: "docx",
      templateId: "general",
      summary: "改过",
      sections: [],
      reviewNotes: [],
      reviewStatus: "modified",
      createdAt: new Date().toISOString(),
    });

    const fleet = await buildAgentFleetSummary({
      workspaceDir,
      jobs: [
        {
          jobId: "sched",
          status: "scheduled",
          matterId: "matter-clarify",
          templateId: "sched-job",
          createdAt: new Date().toISOString(),
        },
        {
          jobId: "failish",
          status: "broken",
          matterId: "matter-clarify",
          templateId: "broken-job",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(fleet.runs.some((r) => r.kind === "chat" && r.status === "awaiting_clarification")).toBe(
      true,
    );
    expect(fleet.runs.some((r) => r.jobId === "sched" && r.status === "scheduled")).toBe(true);
    expect(fleet.runs.some((r) => r.jobId === "failish")).toBe(false);
    expect(
      fleet.runs.some(
        (r) =>
          r.kind === "pending_review" && r.subtitle === "修改后待复核" && r.taskId === "draft-mod",
      ),
    ).toBe(true);
  });
});
