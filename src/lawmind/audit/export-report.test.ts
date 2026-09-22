import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureTaskRecord } from "../tasks/index.js";
import type { AuditEvent, TaskIntent } from "../types.js";
import {
  buildAuditExportMarkdown,
  buildComplianceAuditMarkdown,
  filterAuditEventsForExport,
  formatAuditExportMarkdown,
} from "./index.js";

const baseEvent = (overrides: Partial<AuditEvent>): AuditEvent => ({
  eventId: "e1",
  taskId: "t1",
  kind: "draft.reviewed",
  actor: "lawyer",
  timestamp: "2026-01-15T10:00:00.000Z",
  ...overrides,
});

describe("filterAuditEventsForExport", () => {
  it("filters by taskId", () => {
    const events = [baseEvent({ taskId: "a" }), baseEvent({ taskId: "b", eventId: "e2" })];
    const out = filterAuditEventsForExport(events, "/tmp/ws", { taskId: "b" });
    expect(out).toHaveLength(1);
    expect(out[0].taskId).toBe("b");
  });

  it("taskId wins over matterId when both set", () => {
    const events = [baseEvent({ taskId: "only-this" })];
    const out = filterAuditEventsForExport(events, "/tmp/ws", {
      taskId: "only-this",
      matterId: "m1",
    });
    expect(out).toHaveLength(1);
  });

  it("applies since and until", () => {
    const events = [
      baseEvent({ timestamp: "2026-01-01T00:00:00.000Z" }),
      baseEvent({ timestamp: "2026-06-01T00:00:00.000Z", eventId: "e2", taskId: "t2" }),
    ];
    const out = filterAuditEventsForExport(events, "/tmp/ws", {
      since: "2026-03-01T00:00:00.000Z",
      until: "2026-12-31T23:59:59.999Z",
    });
    expect(out).toHaveLength(1);
    expect(out[0].timestamp.startsWith("2026-06")).toBe(true);
  });

  it("respects maxEvents tail slice", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      baseEvent({
        eventId: `e${i}`,
        taskId: `t${i}`,
        timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
      }),
    );
    const out = filterAuditEventsForExport(events, "/tmp/ws", { maxEvents: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.taskId)).toEqual(["t3", "t4"]);
  });
});

describe("filterAuditEventsForExport by matterId", () => {
  it("keeps events whose taskId belongs to matter from task records", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-audit-matter-"));
    const now = new Date().toISOString();
    const intent: TaskIntent = {
      taskId: "task-m1",
      kind: "draft.word",
      output: "docx",
      instruction: "生成测试文书",
      summary: "s",
      riskLevel: "low",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
      matterId: "case-alpha",
    };
    ensureTaskRecord(ws, intent);
    const events: AuditEvent[] = [
      baseEvent({ taskId: "task-m1", eventId: "e1" }),
      baseEvent({ taskId: "other", eventId: "e2" }),
    ];
    const out = filterAuditEventsForExport(events, ws, { matterId: "case-alpha" });
    expect(out).toHaveLength(1);
    expect(out[0].taskId).toBe("task-m1");
  });
});

describe("buildComplianceAuditMarkdown", () => {
  it("prepends summary and kind counts", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-compliance-"));
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const lines = [
      JSON.stringify({
        eventId: "1",
        taskId: "t1",
        kind: "draft.reviewed",
        actor: "lawyer",
        timestamp: "2026-03-29T12:00:00.000Z",
      }),
      JSON.stringify({
        eventId: "2",
        taskId: "t1",
        kind: "draft.citation_integrity",
        actor: "system",
        timestamp: "2026-03-29T12:00:30.000Z",
      }),
      JSON.stringify({
        eventId: "3",
        taskId: "t1",
        kind: "artifact.rendered",
        actor: "system",
        timestamp: "2026-03-29T12:01:00.000Z",
      }),
    ];
    fs.writeFileSync(path.join(auditDir, "2026-03-29.jsonl"), `${lines.join("\n")}\n`, "utf8");
    const md = await buildComplianceAuditMarkdown(ws, {});
    expect(md).toContain("compliance-oriented");
    expect(md).toContain("Export schema version:** 2");
    expect(md).toContain("`draft.reviewed`");
    expect(md).toContain("`draft.citation_integrity`");
    expect(md).toContain("`artifact.rendered`");
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe("buildAuditExportMarkdown", () => {
  it("reads audit jsonl and formats markdown", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-audit-export-full-"));
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    const line = JSON.stringify({
      eventId: "ev1",
      taskId: "t-export",
      kind: "task.created",
      actor: "system",
      timestamp: "2026-03-29T12:00:00.000Z",
      detail: "created",
    });
    fs.writeFileSync(path.join(auditDir, "2026-03-29.jsonl"), `${line}\n`, "utf8");
    const md = await buildAuditExportMarkdown(ws, {});
    expect(md).toContain("task.created");
    expect(md).toContain("t-export");
  });
});

describe("formatAuditExportMarkdown", () => {
  it("includes header and table row with escaped pipes in detail", () => {
    const md = formatAuditExportMarkdown(
      "/ws",
      [
        baseEvent({
          detail: "a|b",
          actorId: "lawyer:1",
        }),
      ],
      { matterId: "m-x" },
    );
    expect(md).toContain("# LawMind audit export");
    expect(md).toContain("/ws");
    expect(md).toContain("m-x");
    expect(md).toContain("a\\|b");
    expect(md).toContain("draft.reviewed");
  });
});
