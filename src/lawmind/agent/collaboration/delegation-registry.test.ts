import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getDelegation,
  listDelegationFollowUpsForSession,
  markDelegationCompleted,
  markDelegationFailed,
  markDelegationRunning,
  registerDelegation,
  cancelDelegation,
  countActiveDelegations,
  listRunningDelegationsForSession,
  restoreDelegationsFromDisk,
  validateDelegation,
  buildDelegationEvent,
  readDelegationResultFile,
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

  it("running / cancel / validate / restore / events", () => {
    const parentSessionId = "sess-parent-run";
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "运行中",
      parentSessionId,
      depth: 1,
    });
    markDelegationRunning(workspaceDir, rec.delegationId, "sess-child");
    expect(getDelegation(rec.delegationId)?.status).toBe("running");
    expect(
      listRunningDelegationsForSession({ parentSessionId, fromAssistantId: "lead" }).length,
    ).toBe(1);
    expect(countActiveDelegations("lead")).toBeGreaterThan(0);

    const depthFail = validateDelegation({
      fromAssistantId: "lead",
      toAssistantId: "research",
      depth: 99,
      policy: { maxDelegationDepth: 2, maxActiveDelegationsPerAssistant: 5, allowedPairs: [] },
    });
    expect(depthFail).toMatch(/depth/i);

    cancelDelegation(workspaceDir, rec.delegationId, "user abort");
    expect(getDelegation(rec.delegationId)?.status).toBe("cancelled");

    const rec2 = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "持久化",
    });
    markDelegationCompleted(workspaceDir, rec2.delegationId, "ok result");
    const orphanId = "deleg-orphan-disk";
    const orphanPath = path.join(workspaceDir, "delegations", `${orphanId}.json`);
    fsSync.mkdirSync(path.dirname(orphanPath), { recursive: true });
    fsSync.writeFileSync(
      orphanPath,
      JSON.stringify({
        delegationId: orphanId,
        fromAssistantId: "lead",
        toAssistantId: "research",
        task: "from disk",
        status: "completed",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }),
      "utf8",
    );
    const restored = restoreDelegationsFromDisk(workspaceDir);
    expect(restored).toBe(1);
    expect(getDelegation(orphanId)?.task).toBe("from disk");

    const completed = getDelegation(rec2.delegationId)!;
    const evt = buildDelegationEvent(completed, "delegation.completed");
    expect(evt.kind).toBe("delegation.completed");
    expect(readDelegationResultFile(workspaceDir, completed)).toBeUndefined();
  });
});
