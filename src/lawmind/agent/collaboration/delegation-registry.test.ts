import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getDelegation,
  listDelegationFollowUpsForSession,
  markDelegationCompleted,
  markDelegationFailed,
  registerDelegation,
} from "./delegation-registry.js";

describe("delegation-registry", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-deleg-"));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("registers and persists delegation record", () => {
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "整理类案",
      matterId: "matter-1",
    });
    expect(rec.status).toBe("pending");
    const loaded = getDelegation(rec.delegationId);
    expect(loaded?.task).toBe("整理类案");
  });

  it("lists terminal follow-ups for parent session", () => {
    const parentSessionId = "sess-parent";
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "复核草稿",
      parentSessionId,
    });
    registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "仍在进行",
      parentSessionId,
    });
    expect(listDelegationFollowUpsForSession({ parentSessionId, fromAssistantId: "lead" })).toEqual(
      [],
    );
    markDelegationCompleted(workspaceDir, rec.delegationId, "done");
    const followUps = listDelegationFollowUpsForSession({
      parentSessionId,
      fromAssistantId: "lead",
    });
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.delegationId).toBe(rec.delegationId);
    expect(followUps[0]?.status).toBe("completed");
  });

  it("excludes failed delegations from active follow-up polling once terminal", () => {
    const parentSessionId = "sess-fail";
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "会失败的任务",
      parentSessionId,
    });
    markDelegationFailed(workspaceDir, rec.delegationId, "timeout");
    const followUps = listDelegationFollowUpsForSession({
      parentSessionId,
      fromAssistantId: "lead",
    });
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.status).toBe("failed");
  });
});
