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
import { writeRedlineProposal } from "../drafts/redline-proposal.js";
import { openWordReviewTicket, wordReviewPath } from "../drafts/word-review.js";
import { buildAgentFleetSummary } from "./build-agent-fleet.js";
import {
  createMatterRunOnDisk,
  escalateDueMatterRunWaits,
  resumeMatterRuns,
} from "./matter-run-store.js";

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
        toolName: "send_email",
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
    expect(["chat", "tool_approval"]).toContain(fleet.runs[0]?.kind);
  });

  it("leaves assistant-side queue items out of the fleet list", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-queuekinds-"));
    const { openQueueItem } = await import("../application/services/queue-write-service.js");
    openQueueItem(workspaceDir, {
      matterId: "m-qk",
      kind: "need_lawyer_review",
      title: "待签批",
      relatedTaskId: "t1",
    });
    openQueueItem(workspaceDir, {
      matterId: "m-qk",
      kind: "need_partner_approval",
      title: "待合伙人审批",
    });
    openQueueItem(workspaceDir, {
      matterId: "m-qk",
      kind: "ready_to_draft",
      title: "助手待起草",
    });
    openQueueItem(workspaceDir, {
      matterId: "m-qk",
      kind: "need_client_input",
      title: "问客户",
    });

    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const byTitle = new Map(fleet.runs.map((r) => [r.title, r.status]));
    expect(byTitle.get("问客户")).toBe("awaiting_approval");
    expect(byTitle.has("待签批")).toBe(false);
    expect(byTitle.has("待合伙人审批")).toBe(false);
    expect(byTitle.has("助手待起草")).toBe(false);
  });

  it("maps pending intake items into the existing needs-you queue seam", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-intake-"));
    const { recordIntakeItem } = await import("../intake/store.js");
    recordIntakeItem(workspaceDir, {
      channel: "email",
      externalKey: "email:acc-1:message-1",
      receivedAt: "2026-10-26T08:00:00.000Z",
      from: { display: "Client <client@example.com>", address: "client@example.com" },
      subject: "补充诉讼材料",
      text: "请查收附件。",
      attachments: [],
    });

    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const intake = fleet.runs.find((run) => run.intakeItemId);

    expect(intake).toMatchObject({
      id: expect.stringMatching(/^intake:it-/),
      kind: "queue_item",
      status: "awaiting_review",
      title: "补充诉讼材料",
      subtitle: "待处理收件",
    });
    expect(fleet.counts.byKind.queue_item).toBe(1);
  });
  it("keeps today's settled jobs and skips idle chats and older completions", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-idle-"));
    createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-idle",
    });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
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
        {
          jobId: "old-done",
          status: "completed",
          matterId: "matter-idle",
          templateId: "old",
          createdAt: yesterday.toISOString(),
          updatedAt: yesterday.toISOString(),
        },
      ],
    });
    expect(fleet.runs.some((r) => r.kind === "chat")).toBe(false);
    expect(fleet.runs.some((r) => r.jobId === "done" && r.status === "completed")).toBe(true);
    expect(fleet.runs.some((r) => r.jobId === "cancelled" && r.status === "cancelled")).toBe(true);
    expect(fleet.runs.some((r) => r.jobId === "old-done")).toBe(false);
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
          name: "邮件合同审阅",
          templateId: "broken-job",
          error: "材料缺了主体",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(fleet.runs.some((r) => r.kind === "chat" && r.status === "awaiting_clarification")).toBe(
      true,
    );
    expect(fleet.runs.some((r) => r.jobId === "sched" && r.status === "scheduled")).toBe(true);
    const failedJob = fleet.runs.find((r) => r.jobId === "failish");
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.title).toBe("邮件合同审阅");
    expect(failedJob?.note).toBe("材料缺了主体");
    expect(
      fleet.runs.some(
        (r) =>
          r.kind === "pending_review" && r.subtitle === "修改后待审核" && r.taskId === "draft-mod",
      ),
    ).toBe(true);
  });

  it("surfaces a chat that finished today, with the instruction", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-settled-chat-"));
    const session = createSession({
      workspaceDir,
      actorId: "lawyer",
      assistantId: "default",
      matterId: "matter-done",
    });
    session.turns.push({
      turnId: "turn-1",
      sessionId: session.sessionId,
      instruction: "写一份给客户的备忘录",
      messages: [],
      toolCallsExecuted: 0,
      status: "completed",
    });
    session.updatedAt = new Date().toISOString();
    saveSession(workspaceDir, session);
    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const chat = fleet.runs.find((r) => r.kind === "chat");
    expect(chat?.status).toBe("completed");
    expect(chat?.title).toContain("备忘录");
    expect(chat?.title).not.toBe("New Chat");
  });

  it("lists one word_check row per open review and skips a from-scratch opinion", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-word-check-"));
    const reviewAbs = path.join(workspaceDir, "contracts", "服务合同_20260928_01.docx");
    persistDraft(workspaceDir, {
      taskId: "rev-1",
      matterId: "m1",
      title: "服务合同修订",
      output: "docx",
      templateId: "general",
      summary: "",
      sections: [{ heading: "正文", body: "改过" }],
      reviewNotes: [],
      reviewStatus: "approved",
      createdAt: "2026-09-28T00:00:00.000Z",
      outputPath: reviewAbs,
      contractEdit: { baselineRelativePath: "contracts/服务合同.docx", mode: "surgical" },
    });
    writeRedlineProposal(workspaceDir, {
      taskId: "rev-1",
      baselineSections: [{ heading: "正文", body: "原文" }],
      hunks: [
        {
          hunkId: "h1",
          sectionIndex: 0,
          before: "原文",
          after: "改过",
          status: "pending",
        },
        {
          hunkId: "h2",
          sectionIndex: 0,
          before: "不要",
          after: "丢掉",
          status: "rejected",
        },
      ],
      updatedAt: "2026-09-28T01:00:00.000Z",
    });
    expect(openWordReviewTicket({ workspaceDir, taskId: "rev-1", reviewAbs }).opened).toBe(true);
    fs.rmSync(wordReviewPath(workspaceDir, "rev-1")!);
    persistDraft(workspaceDir, {
      taskId: "opinion-1",
      title: "法律意见书",
      output: "docx",
      templateId: "general",
      summary: "",
      sections: [{ heading: "意见", body: "从零写的" }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: "2026-09-28T00:00:00.000Z",
      outputPath: path.join(workspaceDir, "artifacts", "意见.docx"),
    });

    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const checks = fleet.runs.filter((run) => run.kind === "word_check");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.title).toBe("服务合同.docx");
    expect(checks[0]?.subtitle).toBe("1 处修订 · 待核对");
    expect(fleet.runs.some((run) => run.kind === "word_check" && run.taskId === "opinion-1")).toBe(
      false,
    );
    expect(fleet.counts.byKind.word_check).toBe(1);
  });

  it("lists escalated matter-run waits as lawyer decisions, scoped by matter", async () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-fleet-"));
    const at0 = "2026-10-27T04:00:00.000Z";
    createMatterRunOnDisk(workspaceDir, {
      matterId: "matter-1",
      runId: "run_wait",
      steps: [{ kind: "wait_court", title: "等法院立案" }],
      at: at0,
    });
    await resumeMatterRuns(workspaceDir, {
      executors: {
        wait_court: () => ({
          status: "waiting" as const,
          wait: {
            reason: "court_filing" as const,
            eventKeys: ["matter:matter-1"],
            dueAt: "2026-10-28T00:00:00.000Z",
          },
        }),
      },
      at: "2026-10-27T04:01:00.000Z",
    });
    escalateDueMatterRunWaits(workspaceDir, { at: "2026-10-29T00:00:00.000Z" });

    const fleet = await buildAgentFleetSummary({ workspaceDir });
    const row = fleet.runs.find((run) => run.kind === "matter_run_wait");
    expect(row).toMatchObject({
      matterId: "matter-1",
      status: "awaiting_approval",
      title: "等法院立案",
      subtitle: "案件运行",
    });
    expect(row?.matterRunWait).toMatchObject({
      runId: "run_wait",
      stepId: "s1",
      reason: "court_filing",
      dueAt: "2026-10-28T00:00:00.000Z",
      escalatedAt: "2026-10-29T00:00:00.000Z",
    });
    expect(fleet.counts.byKind.matter_run_wait).toBe(1);

    const otherMatter = await buildAgentFleetSummary({ workspaceDir, matterId: "matter-2" });
    expect(otherMatter.runs.some((run) => run.kind === "matter_run_wait")).toBe(false);
  });
});
