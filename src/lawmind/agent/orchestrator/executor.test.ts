import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertAssistant } from "../../assistants/store.js";
import type { AgentConfig } from "../types.js";
import { executeWorkflow, resolveStepAssigneeByRole } from "./executor.js";
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
