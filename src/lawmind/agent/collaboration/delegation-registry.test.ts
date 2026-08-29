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
  markDelegationTimeout,
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

  it("terminal guard: late completion after timeout becomes completed_after_timeout with result kept", () => {
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "可能超时的任务",
    });
    markDelegationRunning(workspaceDir, rec.delegationId, "sess-child");
    markDelegationTimeout(workspaceDir, rec.delegationId);
    expect(getDelegation(rec.delegationId)?.status).toBe("timeout");

    const late = markDelegationCompleted(workspaceDir, rec.delegationId, "迟到的结果");
    expect(late?.status).toBe("completed_after_timeout");
    expect(late?.result).toBe("迟到的结果");
    expect(getDelegation(rec.delegationId)?.status).toBe("completed_after_timeout");

    // 已是终态后，再次完成/失败/取消均不再翻转。
    const again = markDelegationCompleted(workspaceDir, rec.delegationId, "又一次");
    expect(again?.status).toBe("completed_after_timeout");
    expect(again?.result).toBe("迟到的结果");
    const failed = markDelegationFailed(workspaceDir, rec.delegationId, "迟到的失败");
    expect(failed?.status).toBe("completed_after_timeout");
    const cancelled = cancelDelegation(workspaceDir, rec.delegationId);
    expect(cancelled?.status).toBe("completed_after_timeout");
  });

  it("terminal guard: late failure after timeout does not flip status", () => {
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "超时后失败的任务",
    });
    markDelegationTimeout(workspaceDir, rec.delegationId);
    const failed = markDelegationFailed(workspaceDir, rec.delegationId, "late error");
    expect(failed?.status).toBe("timeout");
    expect(getDelegation(rec.delegationId)?.status).toBe("timeout");
  });

  it("terminal guard: completed record ignores later completion/failure writes", () => {
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "正常完成的任务",
    });
    markDelegationCompleted(workspaceDir, rec.delegationId, "首个结果");
    const dup = markDelegationCompleted(workspaceDir, rec.delegationId, "覆盖尝试");
    expect(dup?.status).toBe("completed");
    expect(dup?.result).toBe("首个结果");
    const failed = markDelegationFailed(workspaceDir, rec.delegationId, "失败尝试");
    expect(failed?.status).toBe("completed");
    const timedOut = markDelegationTimeout(workspaceDir, rec.delegationId);
    expect(timedOut?.status).toBe("completed");
    expect(getDelegation(rec.delegationId)?.status).toBe("completed");
  });

  it("completed_after_timeout is terminal for parent-session follow-ups", () => {
    const parentSessionId = "sess-late";
    const rec = registerDelegation({
      workspaceDir,
      fromAssistantId: "lead",
      toAssistantId: "research",
      task: "超时但交回",
      parentSessionId,
    });
    markDelegationTimeout(workspaceDir, rec.delegationId);
    markDelegationCompleted(workspaceDir, rec.delegationId, "late result");
    const followUps = listDelegationFollowUpsForSession({
      parentSessionId,
      fromAssistantId: "lead",
    });
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.status).toBe("completed_after_timeout");
    expect(
      listRunningDelegationsForSession({ parentSessionId, fromAssistantId: "lead" }),
    ).toHaveLength(0);
  });
});
