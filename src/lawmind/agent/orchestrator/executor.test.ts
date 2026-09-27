import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAssistant } from "../../assistants/store.js";
import type { AgentConfig } from "../types.js";
import {
  DEFAULT_COLLAB_STEP_TIMEOUT_MS,
  executeWorkflow,
  findWorkflowDependencyCycle,
  resolveCollabStepTimeoutMs,
  resolveStepAssigneeByRole,
  buildWorkflowReport,
  releaseWorkflowLawyerHold,
} from "./executor.js";
import type { CollaborationWorkflow, WorkflowStep } from "./types.js";

const mockSendAndWait = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ reply: "delegation-reply", sessionId: "sess-1" }),
);

vi.mock("../collaboration/message-bus.js", () => ({
  sendAndWait: (...args: unknown[]) => mockSendAndWait(...args),
  wrapUntrustedResult: (s: string) => s,
}));

vi.mock("../collaboration/delegation-registry.js", () => ({
  registerDelegation: () => ({
    delegationId: "del-1",
    fromAssistantId: "a",
    toAssistantId: "b",
    task: "t",
    status: "pending" as const,
    priority: "normal" as const,
    depth: 0,
    startedAt: new Date().toISOString(),
  }),
  markDelegationRunning: vi.fn(),
  markDelegationAwaitingLawyer: vi.fn(),
  markDelegationCompleted: vi.fn(),
  markDelegationFailed: vi.fn(),
}));

vi.mock("../collaboration/audit.js", () => ({
  emitCollaborationEvent: vi.fn(),
}));

function tmpWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-orch-"));
}

function wfTwoStepChain(): CollaborationWorkflow {
  const now = new Date().toISOString();
  return {
    workflowId: "wf-abort",
    name: "Abort test",
    description: "",
    steps: [
      {
        stepId: "s1",
        assignee: "asst-a",
        task: "first",
        dependsOn: [],
        autoApprove: true,
        status: "pending",
      },
      {
        stepId: "s2",
        assignee: "asst-b",
        task: "second",
        dependsOn: ["s1"],
        autoApprove: true,
        status: "pending",
      },
    ],
    status: "draft",
    createdBy: "lawyer",
    createdAt: now,
    updatedAt: now,
  };
}

const stubConfig = (workspaceDir: string): AgentConfig => ({
  workspaceDir,
  model: {
    provider: "openai-compatible",
    baseUrl: "http://localhost",
    apiKey: "k",
    model: "m",
  },
});

describe("resolveCollabStepTimeoutMs", () => {
  it("defaults to a generous window instead of the old hard 300s", () => {
    // 300s 会稳定打断「读合同 → 多轮改稿 → 独立审稿」这类真活。
    expect(resolveCollabStepTimeoutMs({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_COLLAB_STEP_TIMEOUT_MS,
    );
    expect(DEFAULT_COLLAB_STEP_TIMEOUT_MS).toBeGreaterThan(300_000);
  });

  it("honours an explicit override", () => {
    expect(
      resolveCollabStepTimeoutMs({
        LAWMIND_COLLAB_STEP_TIMEOUT_MS: "1200000",
      } as NodeJS.ProcessEnv),
    ).toBe(1_200_000);
  });

  it("clamps silly values instead of silently breaking every step", () => {
    // 太小会把正常任务打断；太大等于没有上限。夹在 30s ~ 60min。
    expect(
      resolveCollabStepTimeoutMs({ LAWMIND_COLLAB_STEP_TIMEOUT_MS: "1" } as NodeJS.ProcessEnv),
    ).toBe(30_000);
    expect(
      resolveCollabStepTimeoutMs({
        LAWMIND_COLLAB_STEP_TIMEOUT_MS: "99999999",
      } as NodeJS.ProcessEnv),
    ).toBe(3_600_000);
    expect(
      resolveCollabStepTimeoutMs({ LAWMIND_COLLAB_STEP_TIMEOUT_MS: "abc" } as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_COLLAB_STEP_TIMEOUT_MS);
  });
});

describe("resolveStepAssigneeByRole", () => {
  it("resolves contract_review via envFile assistants (presetKey), not workspace sibling", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    // Stale sibling assistants.json (what resolveLawMindRoot(workspace) alone would see)
    fs.writeFileSync(
      path.join(lawMindRoot, "..", "assistants-should-not-matter.json"),
      "[]",
      "utf8",
    );
    upsertAssistant(lawMindRoot, {
      assistantId: "lvyx",
      displayName: "吕盈修",
      introduction: "",
      presetKey: "contract_review",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");

    const step: WorkflowStep = {
      stepId: "redline",
      assignee: "contract_review",
      assigneeRoleId: "contract_review",
      task: "edit",
      dependsOn: [],
      autoApprove: true,
      status: "pending",
    };
    resolveStepAssigneeByRole(workspaceDir, step, envFile);
    expect(step.assignee).toBe("lvyx");
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("falls back to default when role has no matching assistant", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root2-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "default",
      displayName: "默认助手",
      introduction: "",
      presetKey: "general_default",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const step: WorkflowStep = {
      stepId: "redline",
      assignee: "contract_review",
      assigneeRoleId: "contract_review",
      task: "edit",
      dependsOn: [],
      autoApprove: true,
      status: "pending",
    };
    resolveStepAssigneeByRole(workspaceDir, step, envFile);
    expect(step.assignee).toBe("default");
    expect(step.roleMissNote).toContain("没有承担");
    expect(step.roleMissNote).toContain("默认助手");
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("refuses to reassign a missing role when several assistants are on the roster", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root3-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "default",
      displayName: "默认助手",
      introduction: "",
      presetKey: "general_default",
    });
    upsertAssistant(lawMindRoot, {
      assistantId: "lit",
      displayName: "诉讼助手",
      introduction: "",
      presetKey: "general_litigation",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const step: WorkflowStep = {
      stepId: "redline",
      assignee: "contract_review",
      assigneeRoleId: "contract_review",
      task: "edit",
      dependsOn: [],
      autoApprove: true,
      status: "pending",
    };
    expect(() => resolveStepAssigneeByRole(workspaceDir, step, envFile)).toThrow(/不能改派/);
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("maps a legacy template name onto the real role when someone holds it", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root-alias-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "memo",
      displayName: "备忘录",
      introduction: "",
      presetKey: "client_memo",
    });
    upsertAssistant(lawMindRoot, {
      assistantId: "default",
      displayName: "默认助手",
      introduction: "",
      presetKey: "general_default",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const step: WorkflowStep = {
      stepId: "deck",
      assignee: "client_communicator",
      task: "课件",
      dependsOn: [],
      autoApprove: true,
      status: "pending",
    };
    resolveStepAssigneeByRole(workspaceDir, step, envFile);
    expect(step.assignee).toBe("memo");
    expect(step.roleMissNote).toBeUndefined();
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });

  it("does not block a legacy template name when nobody holds the mapped role", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-root-alias2-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "default",
      displayName: "默认助手",
      introduction: "",
      presetKey: "general_default",
    });
    upsertAssistant(lawMindRoot, {
      assistantId: "lit",
      displayName: "诉讼助手",
      introduction: "",
      presetKey: "general_litigation",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const step: WorkflowStep = {
      stepId: "deck",
      assignee: "client_communicator",
      task: "课件",
      dependsOn: [],
      autoApprove: true,
      status: "pending",
    };
    resolveStepAssigneeByRole(workspaceDir, step, envFile);
    expect(step.assignee).toBe("default");
    expect(step.roleMissNote).toContain("客户沟通与备忘录");
    expect(step.roleMissNote).toContain("默认助手");
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });
});

describe("executeWorkflow shouldAbort", () => {
  beforeEach(() => {
    mockSendAndWait.mockImplementation(async () => ({
      reply: "delegation-reply",
      sessionId: "sess-1",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stops after first batch when shouldAbort becomes true after first sendAndWait", async () => {
    const workspaceDir = tmpWorkspace();
    const abortAfterFirstDelegation = { flag: false };
    mockSendAndWait.mockImplementation(async () => {
      abortAfterFirstDelegation.flag = true;
      return { reply: "delegation-reply", sessionId: "sess-1" };
    });

    const workflow = wfTwoStepChain();
    const finished = await executeWorkflow(stubConfig(workspaceDir), workflow, {
      shouldAbort: () => abortAfterFirstDelegation.flag,
    });

    expect(finished.status).toBe("cancelled");
    expect(finished.steps[0]?.status).toBe("completed");
    expect(finished.steps[1]?.status).toBe("pending");
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("completes normally when shouldAbort is absent", async () => {
    const workspaceDir = tmpWorkspace();
    const workflow = wfTwoStepChain();
    const finished = await executeWorkflow(stubConfig(workspaceDir), workflow);
    expect(finished.status).toBe("completed");
    expect(finished.steps.every((s) => s.status === "completed")).toBe(true);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("calls onProgress when the workflow starts and as steps move", async () => {
    const workspaceDir = tmpWorkspace();
    const onProgress = vi.fn();
    const workflow = wfTwoStepChain();
    await executeWorkflow(stubConfig(workspaceDir), workflow, { onProgress });
    expect(onProgress).toHaveBeenCalled();
    const first = onProgress.mock.calls[0]?.[0];
    expect(first?.totalSteps).toBe(2);
    expect(first?.completedSteps).toBe(0);
    expect(first?.runningStepIds?.length ?? 0).toBe(0);
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1]?.[0];
    expect(last?.completedSteps).toBe(2);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});

function wfWithSteps(
  steps: Array<Pick<WorkflowStep, "stepId" | "task"> & { dependsOn?: string[] }>,
): CollaborationWorkflow {
  const now = new Date().toISOString();
  return {
    workflowId: "wf-deps",
    name: "Dependency test",
    description: "",
    steps: steps.map((s) => ({
      stepId: s.stepId,
      assignee: "asst-a",
      task: s.task,
      dependsOn: s.dependsOn ?? [],
      autoApprove: true,
      status: "pending" as const,
    })),
    status: "draft",
    createdBy: "lawyer",
    createdAt: now,
    updatedAt: now,
  };
}

describe("executeWorkflow dependency graph hardening", () => {
  beforeEach(() => {
    mockSendAndWait.mockImplementation(async () => ({
      reply: "delegation-reply",
      sessionId: "sess-1",
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("detects a dependency cycle (A→B→A) and throws instead of silently stalling", async () => {
    const workspaceDir = tmpWorkspace();
    const workflow = wfWithSteps([
      { stepId: "a", task: "step a", dependsOn: ["b"] },
      { stepId: "b", task: "step b", dependsOn: ["a"] },
    ]);
    await expect(executeWorkflow(stubConfig(workspaceDir), workflow)).rejects.toThrow(/循环依赖/);
    expect(mockSendAndWait).not.toHaveBeenCalled();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("detects a self-dependency cycle", () => {
    const steps = wfWithSteps([{ stepId: "a", task: "step a", dependsOn: ["a"] }]).steps;
    expect(findWorkflowDependencyCycle(steps)).toEqual(["a", "a"]);
    expect(findWorkflowDependencyCycle(wfTwoStepChain().steps)).toBeNull();
  });

  it("propagates dependency failure: dependents are skipped (transitively) with a reason", async () => {
    const workspaceDir = tmpWorkspace();
    mockSendAndWait.mockImplementation(async (args: { message: string }) => {
      if (args.message.includes("failing-step")) {
        throw new Error("delegation failed");
      }
      return { reply: "delegation-reply", sessionId: "sess-1" };
    });
    const workflow = wfWithSteps([
      { stepId: "s1", task: "failing-step" },
      { stepId: "s2", task: "depends on s1", dependsOn: ["s1"] },
      { stepId: "s3", task: "depends on s2", dependsOn: ["s2"] },
      { stepId: "s4", task: "independent" },
    ]);
    const finished = await executeWorkflow(stubConfig(workspaceDir), workflow);

    const byId = new Map(finished.steps.map((s) => [s.stepId, s]));
    expect(byId.get("s1")?.status).toBe("failed");
    expect(byId.get("s2")?.status).toBe("skipped");
    expect(byId.get("s2")?.error).toContain("s1");
    expect(byId.get("s3")?.status).toBe("skipped");
    expect(byId.get("s4")?.status).toBe("completed");
    // s2 / s3 不再派发：只有 s1 与 s4 真正执行。
    expect(mockSendAndWait).toHaveBeenCalledTimes(2);
    expect(finished.status).toBe("failed");
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("caps parallel step dispatch at the configured concurrency", async () => {
    const workspaceDir = tmpWorkspace();
    vi.stubEnv("LAWMIND_MAX_TOOL_CONCURRENCY", "3");
    let inFlight = 0;
    let maxInFlight = 0;
    mockSendAndWait.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return { reply: "delegation-reply", sessionId: "sess-1" };
    });
    const workflow = wfWithSteps(
      Array.from({ length: 7 }, (_, i) => ({ stepId: `p${i}`, task: `parallel ${i}` })),
    );
    const finished = await executeWorkflow(stubConfig(workspaceDir), workflow);

    expect(finished.status).toBe("completed");
    expect(mockSendAndWait).toHaveBeenCalledTimes(7);
    expect(maxInFlight).toBe(3);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("writes named workflow steps on a deliver turn, and reviews them in isolation", async () => {
    const workspaceDir = tmpWorkspace();
    const workflow = wfTwoStepChain();
    workflow.steps = [
      {
        ...workflow.steps[0],
        autoApprove: false,
        reviewBy: "reviewer",
      },
    ];
    workflow.preApproveToolNames = ["apply_surgical_edits", "render_tracked_draft", "send_email"];
    await executeWorkflow(stubConfig(workspaceDir), workflow);
    const executions = mockSendAndWait.mock.calls.map(
      (call) => (call[0] as { execution?: string }).execution,
    );
    expect(executions).toEqual(["deliver", "isolated"]);
    expect(mockSendAndWait.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        preApproveToolNames: ["apply_surgical_edits", "render_tracked_draft"],
      }),
    );
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("reads peer-review steps in isolation", async () => {
    const workspaceDir = tmpWorkspace();
    const workflow = wfTwoStepChain();
    workflow.steps[1] = {
      ...workflow.steps[1],
      task: "互审合同审查意见：核对风险分级",
    };
    await executeWorkflow(stubConfig(workspaceDir), workflow);
    const executions = mockSendAndWait.mock.calls.map(
      (call) => (call[0] as { execution?: string }).execution,
    );
    expect(executions).toEqual(["deliver", "isolated"]);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("does not start the next step while a turn is waiting on the lawyer", async () => {
    const workspaceDir = tmpWorkspace();
    mockSendAndWait.mockResolvedValue({
      reply: "请确认大纲",
      sessionId: "sess-1",
      hold: "awaiting_clarification",
    });
    const workflow = wfTwoStepChain();
    const finished = await executeWorkflow(stubConfig(workspaceDir), workflow);
    expect(finished.status).toBe("awaiting_lawyer");
    expect(finished.steps[0]?.status).toBe("awaiting_lawyer");
    expect(finished.steps[0]?.sessionId).toBe("sess-1");
    expect(finished.steps[1]?.status).toBe("pending");
    expect(mockSendAndWait).toHaveBeenCalledTimes(1);
    expect(buildWorkflowReport(finished)).toContain("待确认");
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("holds an outline step until the lawyer confirms, then continues", async () => {
    const workspaceDir = tmpWorkspace();
    const workflow = wfTwoStepChain();
    workflow.steps[0] = {
      ...workflow.steps[0],
      task: "输出课件大纲并等待律师确认（research_outline_confirm）",
    };
    mockSendAndWait.mockResolvedValue({
      reply: "一、开场",
      sessionId: "sess-1",
    });
    const held = await executeWorkflow(stubConfig(workspaceDir), workflow);
    expect(held.status).toBe("awaiting_lawyer");
    expect(held.steps[1]?.status).toBe("pending");
    expect(releaseWorkflowLawyerHold(held)).toBe(true);
    mockSendAndWait.mockResolvedValue({
      reply: "正文已写",
      sessionId: "sess-2",
    });
    const finished = await executeWorkflow(stubConfig(workspaceDir), held);
    expect(finished.status).toBe("completed");
    expect(finished.steps[1]?.status).toBe("completed");
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });
});

describe("buildWorkflowReport", () => {
  it("shows the lawyer who covered a missing role", () => {
    const workflow = wfTwoStepChain();
    workflow.steps[0] = {
      ...workflow.steps[0],
      status: "completed",
      result: "意见已写好",
      roleMissNote: "没有承担「合同审查」的助手。本步由「默认助手」办理。",
    };
    const report = buildWorkflowReport(workflow);
    expect(report).toContain("没有承担「合同审查」的助手");
    expect(report).toContain("默认助手");
  });
});
