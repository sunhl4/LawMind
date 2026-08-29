/**
 * W5 — MemoryAdoptionService smoke tests.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  adoptMemorySuggestion,
  dismissMemorySuggestion,
  listMemorySuggestions,
  listPendingMemorySuggestions,
  suggestMemoryAdoption,
} from "./adoption-service.js";

describe("MemoryAdoptionService (W5)", () => {
  let workspaceDir: string;
  let auditDir: string;
  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-adoption-"));
    auditDir = path.join(workspaceDir, "audit");
    await fs.mkdir(auditDir, { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("suggest with autoAdopt=true marks as auto_adopted and emits audit", async () => {
    const rec = await suggestMemoryAdoption(
      workspaceDir,
      auditDir,
      {
        scope: "matter",
        kind: "case.core_issue",
        targetId: "matter-1",
        payload: "issue body",
        sourceTaskId: "task-1",
      },
      { autoAdopt: true },
    );
    expect(rec.state).toBe("auto_adopted");
    expect(rec.resolvedAt).toBeDefined();
  });

  it("suggest pending then adopt invokes writer and updates state", async () => {
    const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "playbook",
      kind: "playbook.clause_learning",
      payload: "clause body",
      origin: "agent",
    });
    expect(rec.state).toBe("pending");

    let writerCalled = false;
    const result = await adoptMemorySuggestion(workspaceDir, auditDir, rec.id, () => {
      writerCalled = true;
    });
    expect(result.ok).toBe(true);
    expect(writerCalled).toBe(true);
    expect(result.record?.state).toBe("adopted");

    const all = await listMemorySuggestions(workspaceDir);
    expect(all.find((r) => r.id === rec.id)?.state).toBe("adopted");
  });

  it("dismiss marks pending suggestion as dismissed", async () => {
    const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "lawyer",
      kind: "lawyer.profile_learning",
      payload: "preference body",
    });
    const result = await dismissMemorySuggestion(workspaceDir, auditDir, rec.id, {
      actorId: "lawyer:test",
      note: "no longer relevant",
    });
    expect(result.ok).toBe(true);
    expect(result.record?.state).toBe("dismissed");
    expect(result.record?.note).toContain("no longer relevant");
  });

  it("listPendingMemorySuggestions filters by scope/state", async () => {
    await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "matter",
      kind: "case.task_goal",
      payload: "goal A",
    });
    await suggestMemoryAdoption(
      workspaceDir,
      auditDir,
      {
        scope: "matter",
        kind: "case.task_goal",
        payload: "goal B (auto)",
      },
      { autoAdopt: true },
    );
    const pending = await listPendingMemorySuggestions(workspaceDir, { scope: "matter" });
    expect(pending.length).toBe(1);
    expect(pending[0].payload).toBe("goal A");
  });

  it("rejects double adopt of same suggestion", async () => {
    const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "matter",
      kind: "case.risk_note",
      payload: "risk body",
    });
    await adoptMemorySuggestion(workspaceDir, auditDir, rec.id, () => {});
    const second = await adoptMemorySuggestion(workspaceDir, auditDir, rec.id, () => {});
    expect(second.ok).toBe(false);
    expect(second.error).toBe("not_pending");
  });

  it("concurrent suggest (append) and adopt (rewrite) never lose records", async () => {
    // 互斥前：adopt 的读-改-全量重写可用旧快照覆盖并发 suggest 的 append。
    const first = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "matter",
      kind: "case.risk_note",
      payload: "risk A",
    });
    await Promise.all([
      suggestMemoryAdoption(workspaceDir, auditDir, {
        scope: "matter",
        kind: "case.risk_note",
        payload: "risk B",
      }),
      suggestMemoryAdoption(workspaceDir, auditDir, {
        scope: "matter",
        kind: "case.risk_note",
        payload: "risk C",
      }),
      adoptMemorySuggestion(workspaceDir, auditDir, first.id, () => {}),
    ]);
    const all = await listMemorySuggestions(workspaceDir);
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.id === first.id)?.state).toBe("adopted");
    expect(all.filter((r) => r.state === "pending")).toHaveLength(2);
  });
});
