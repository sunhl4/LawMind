import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit } from "../audit/index.js";
import {
  rebuildWorkspaceSearchIndex,
  indexExists,
  syncWorkspaceSearchIndex,
} from "./fts-ingest.js";
import {
  computeSearchIndexFreshness,
  searchWorkspaceIndex,
  getSearchIndexStatus,
} from "./fts-search.js";

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

  it("computeSearchIndexFreshness flags missing / old / fresh correctly", () => {
    const now = Date.parse("2026-08-02T00:00:00.000Z");
    expect(computeSearchIndexFreshness({ ready: false }, now)).toEqual({
      stale: true,
      staleReason: "index_missing",
    });
    expect(computeSearchIndexFreshness({ ready: true, lastRebuildAt: undefined }, now).stale).toBe(
      true,
    );
    const changed = computeSearchIndexFreshness(
      { ready: true, lastRebuildAt: new Date(now - 60_000).toISOString(), sourcesChanged: true },
      now,
    );
    expect(changed).toEqual({ stale: true, staleReason: "sources_changed" });
    const fresh = computeSearchIndexFreshness(
      {
        ready: true,
        lastRebuildAt: new Date(now - 86_400_000).toISOString(),
        sourcesChanged: false,
      },
      now,
    );
    expect(fresh.stale).toBe(false);
  });

  it("picks up a changed knowledge file without a full rebuild", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-fts-inc-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "memory"), { recursive: true });
    const note = path.join(ws, "memory", "clause-note.md");
    fs.writeFileSync(note, "## 付款\n\nuniqueKeywordBeta987 分期支付\n");
    const first = await syncWorkspaceSearchIndex(ws);
    expect(first.mode).toBe("rebuild");
    expect(
      searchWorkspaceIndex(ws, { q: "uniqueKeywordBeta987", sources: ["knowledge"] }).hits.length,
    ).toBeGreaterThan(0);
    fs.writeFileSync(note, "## 付款\n\nuniqueKeywordGamma654 一次付清\n");
    const second = await syncWorkspaceSearchIndex(ws);
    expect(second.mode).toBe("incremental");
    const hits = searchWorkspaceIndex(ws, { q: "uniqueKeywordGamma654", sources: ["knowledge"] });
    expect(hits.hits.length).toBeGreaterThan(0);
    expect(
      searchWorkspaceIndex(ws, { q: "uniqueKeywordBeta987", sources: ["knowledge"] }).hits.length,
    ).toBe(0);
    const third = await syncWorkspaceSearchIndex(ws);
    expect(third.knowledgeRows).toBe(second.knowledgeRows);
  });
});
