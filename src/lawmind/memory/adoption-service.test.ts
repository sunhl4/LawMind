/**
 * W5 — MemoryAdoptionService smoke tests.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAX_RESOLVED_SUGGESTIONS,
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

  it("reuses an equivalent pending habit instead of enqueueing a duplicate", async () => {
    const first = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "lawyer",
      kind: "lawyer.habit_pattern",
      payload: "审查「管辖」条款时，默认采用：北京仲裁",
      note: "habit_min_5",
    });
    const second = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "lawyer",
      kind: "lawyer.habit_pattern",
      payload: "审查「管辖」条款时，默认采用：北京仲裁",
      note: "habit_min_5",
    });
    expect(second.id).toBe(first.id);
    expect(second.reusedPending).toBe(true);
    const all = await listMemorySuggestions(workspaceDir, { state: "pending" });
    expect(all.filter((r) => r.kind === "lawyer.habit_pattern")).toHaveLength(1);
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

  it("adopt 时 writer 回执 noopReason → 状态记为 recorded_noop 而非 adopted", async () => {
    const rec = await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "project",
      kind: "project.note",
      payload: "项目级备注",
    });
    const result = await adoptMemorySuggestion(workspaceDir, auditDir, rec.id, () => ({
      written: [],
      noopReason: "project 暂无落盘存储面，采纳仅记录决策",
    }));
    expect(result.ok).toBe(true);
    expect(result.record?.state).toBe("recorded_noop");
    expect(result.record?.noopReason).toContain("暂无落盘存储面");
    const all = await listMemorySuggestions(workspaceDir);
    expect(all.find((r) => r.id === rec.id)?.state).toBe("recorded_noop");
    // 审计也必须如实：不是 adoption_adopted
    const { readAllAuditLogs } = await import("../audit/index.js");
    const events = await readAllAuditLogs(auditDir);
    expect(events.some((e) => e.kind === "memory.adoption_recorded_noop")).toBe(true);
    expect(events.some((e) => e.kind === "memory.adoption_adopted")).toBe(false);
  });

  it("suggestions.jsonl 有界：已决历史压缩到最近窗口，pending 全量保留", async () => {
    // 直接铺 1150 条已决 + 100 条未决（超过 1000+200 滞后阈值）
    const dir = path.join(workspaceDir, "memory-adoption");
    await fs.mkdir(dir, { recursive: true });
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const rows: string[] = [];
    for (let i = 0; i < 1150; i += 1) {
      rows.push(
        JSON.stringify({
          id: `resolved-${i}`,
          createdAt: new Date(base + i * 1000).toISOString(),
          state: i % 2 === 0 ? "adopted" : "dismissed",
          scope: "matter",
          kind: "case.risk_note",
          payload: `resolved ${i}`,
          origin: "engine",
          resolvedAt: new Date(base + i * 1000).toISOString(),
        }),
      );
    }
    for (let i = 0; i < 100; i += 1) {
      rows.push(
        JSON.stringify({
          id: `pending-${i}`,
          createdAt: new Date(base + 2_000_000 + i * 1000).toISOString(),
          state: "pending",
          scope: "matter",
          kind: "case.risk_note",
          payload: `pending ${i}`,
          origin: "engine",
        }),
      );
    }
    await fs.writeFile(path.join(dir, "suggestions.jsonl"), `${rows.join("\n")}\n`, "utf8");

    // 再 append 一条即触发压缩
    await suggestMemoryAdoption(workspaceDir, auditDir, {
      scope: "matter",
      kind: "case.risk_note",
      payload: "trigger compaction",
    });

    const all = await listMemorySuggestions(workspaceDir);
    // 总量回到窗口：101 pending + 899 最近已决 = 1000
    expect(all).toHaveLength(MAX_RESOLVED_SUGGESTIONS);
    const pending = await listPendingMemorySuggestions(workspaceDir);
    expect(pending).toHaveLength(101);
    // 最旧的已决被压缩掉，最近的保留
    expect(all.some((r) => r.id === "resolved-250")).toBe(false);
    expect(all.some((r) => r.id === "resolved-251")).toBe(true);
    expect(all.some((r) => r.id === "resolved-1149")).toBe(true);
  });
});
