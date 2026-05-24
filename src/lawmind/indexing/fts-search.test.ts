import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit } from "../audit/index.js";
import { rebuildWorkspaceSearchIndex, indexExists } from "./fts-ingest.js";
import { searchWorkspaceIndex, getSearchIndexStatus } from "./fts-search.js";

describe("workspace search index", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("rebuilds and searches audit events", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fts-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "audit"), { recursive: true });
    await emit(path.join(ws, "audit"), {
      taskId: "task-fts-1",
      kind: "task.created",
      actor: "system",
      detail: "uniqueKeywordAlpha123 contract review",
    });
    const result = await rebuildWorkspaceSearchIndex(ws);
    expect(result.auditRows).toBeGreaterThan(0);
    expect(indexExists(ws)).toBe(true);
    const search = searchWorkspaceIndex(ws, { q: "uniqueKeywordAlpha123" });
    expect(search.hits.length).toBeGreaterThan(0);
    expect(search.hits[0]?.source).toBe("audit");
    const status = getSearchIndexStatus(ws);
    expect(status.ready).toBe(true);
  });
});
