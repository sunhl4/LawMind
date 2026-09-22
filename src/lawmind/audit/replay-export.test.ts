import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditEvent } from "../types.js";
import { buildAuditReplayExport } from "./index.js";

function writeEvent(auditDir: string, e: AuditEvent): void {
  const day = e.timestamp.slice(0, 10);
  const file = path.join(auditDir, `${day}.jsonl`);
  fs.appendFileSync(file, `${JSON.stringify(e)}\n`);
}

describe("buildAuditReplayExport", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("returns schemaVersion 1 with events and task groups", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-replay-"));
    dirs.push(ws);
    const auditDir = path.join(ws, "audit");
    fs.mkdirSync(auditDir, { recursive: true });
    writeEvent(auditDir, {
      eventId: "e1",
      taskId: "t-a",
      kind: "task.created",
      actor: "system",
      timestamp: "2026-05-20T10:00:00.000Z",
    });
    writeEvent(auditDir, {
      eventId: "e2",
      taskId: "t-a",
      kind: "draft.created",
      actor: "system",
      timestamp: "2026-05-20T10:01:00.000Z",
    });
    const out = await buildAuditReplayExport(ws, { taskId: "t-a" });
    expect(out.schemaVersion).toBe(1);
    expect(out.events.length).toBe(2);
    expect(out.tasks["t-a"]?.length).toBe(2);
    expect(out.summary.byKind["task.created"]).toBe(1);
  });
});
