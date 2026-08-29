import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emit } from "../audit/index.js";
import { ensureTaskRecord } from "../tasks/index.js";
import {
  indexExists,
  openSearchIndexDb,
  rebuildWorkspaceSearchIndex,
} from "./fts-ingest.js";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fts-ingest-"));
  dirs.push(d);
  fs.mkdirSync(path.join(d, "audit"), { recursive: true });
  return d;
}

describe("indexing/fts-ingest", () => {
  it("openSearchIndexDb creates schema", () => {
    const ws = tmpWs();
    const db = openSearchIndexDb(ws);
    expect(db).toBeTruthy();
    db.close();
    expect(indexExists(ws)).toBe(true);
  });

  it("rebuildWorkspaceSearchIndex ingests audit and session rows", async () => {
    const ws = tmpWs();
    const now = new Date().toISOString();
    ensureTaskRecord(ws, {
      taskId: "task-fts",
      matterId: "matter-fts",
      kind: "draft.word",
      output: "docx",
      instruction: "写备忘",
      summary: "写备忘",
      riskLevel: "medium",
      models: ["general"],
      requiresConfirmation: false,
      createdAt: now,
    });
    await emit(path.join(ws, "audit"), {
      taskId: "task-fts",
      kind: "draft.saved",
      actor: "system",
      detail: "saved draft for indexing",
    });
    const sessionsDir = path.join(ws, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, "sess-1.json"),
      JSON.stringify({
        sessionId: "sess-1",
        matterId: "matter-fts",
        updatedAt: now,
      }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(sessionsDir, "sess-1.turns.jsonl"),
      `${JSON.stringify({ turnId: "t1", instruction: "检索争点", result: "押金退还" })}\n`,
      "utf8",
    );

    const result = await rebuildWorkspaceSearchIndex(ws, {
      maxAuditRows: 100,
      maxSessionRows: 100,
      maxKnowledgeRows: 100,
    });
    expect(result.ok).toBe(true);
    expect(result.auditRows).toBeGreaterThan(0);
    expect(result.sessionRows).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
