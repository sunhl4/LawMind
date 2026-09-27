import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeTestWorkspaceDir } from "../../../test/lawmind-workspace-cleanup.js";
import { emit, readAuditEventsForTaskIds, readRecentAuditLogs } from "./index.js";

describe("readAuditEventsForTaskIds", () => {
  let workspaceDir: string;
  let auditDir: string;

  afterEach(async () => {
    if (workspaceDir) {
      await removeTestWorkspaceDir(workspaceDir);
    }
  });

  it("returns only matching task events and prefers newest when capped", async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-audit-task-"));
    auditDir = path.join(workspaceDir, "audit");
    await fs.mkdir(auditDir, { recursive: true });

    const dayA = path.join(auditDir, "2026-01-01.jsonl");
    const dayB = path.join(auditDir, "2026-01-02.jsonl");
    await fs.writeFile(
      dayA,
      [
        JSON.stringify({
          eventId: "e1",
          taskId: "keep",
          kind: "task.created",
          actor: "system",
          timestamp: "2026-01-01T10:00:00.000Z",
          detail: "old keep",
        }),
        JSON.stringify({
          eventId: "e2",
          taskId: "other",
          kind: "task.created",
          actor: "system",
          timestamp: "2026-01-01T11:00:00.000Z",
          detail: "noise",
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(
      dayB,
      [
        JSON.stringify({
          eventId: "e3",
          taskId: "keep",
          kind: "task.confirmed",
          actor: "lawyer",
          timestamp: "2026-01-02T10:00:00.000Z",
          detail: "new keep",
        }),
        JSON.stringify({
          eventId: "e4",
          taskId: "keep",
          kind: "draft.created",
          actor: "system",
          timestamp: "2026-01-02T12:00:00.000Z",
          detail: "newest keep",
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const allKeep = await readAuditEventsForTaskIds(auditDir, new Set(["keep"]), {
      maxDays: 30,
      maxEvents: 10,
    });
    expect(allKeep.map((e) => e.eventId)).toEqual(["e1", "e3", "e4"]);
    expect(allKeep.every((e) => e.taskId === "keep")).toBe(true);

    const capped = await readAuditEventsForTaskIds(auditDir, new Set(["keep"]), {
      maxDays: 30,
      maxEvents: 2,
    });
    expect(capped.map((e) => e.eventId)).toEqual(["e3", "e4"]);

    const empty = await readAuditEventsForTaskIds(auditDir, new Set(), { maxEvents: 5 });
    expect(empty).toEqual([]);
  });

  it("agrees with filter-after-readRecent on emit-backed workspace", async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lm-audit-emit-"));
    auditDir = path.join(workspaceDir, "audit");
    await fs.mkdir(auditDir, { recursive: true });

    await emit(auditDir, {
      taskId: "t-a",
      kind: "task.created",
      actor: "system",
      detail: "a1",
      integrityChain: false,
    });
    await emit(auditDir, {
      taskId: "t-b",
      kind: "task.created",
      actor: "system",
      detail: "b1",
      integrityChain: false,
    });
    await emit(auditDir, {
      taskId: "t-a",
      kind: "task.confirmed",
      actor: "lawyer",
      actorId: "lawyer:1",
      detail: "a2",
      integrityChain: false,
    });

    const viaFilter = (
      await readRecentAuditLogs(auditDir, { maxDays: 30, maxEvents: 8_000 })
    ).filter((e) => e.taskId === "t-a");
    const viaScoped = await readAuditEventsForTaskIds(auditDir, new Set(["t-a"]), {
      maxDays: 30,
      maxEvents: 500,
    });
    expect(viaScoped.map((e) => e.eventId)).toEqual(viaFilter.map((e) => e.eventId));
  });
});
