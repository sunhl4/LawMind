import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchBundle } from "../types.js";
import {
  persistResearchSnapshot,
  readResearchSnapshot,
  researchSnapshotPath,
} from "./research-snapshot.js";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-rs-"));
}

afterEach(() => {
  /* dirs left in tmp; OS cleans periodically */
});

function minimalBundle(taskId: string): ResearchBundle {
  return {
    taskId,
    query: "q",
    sources: [{ id: "s1", title: "t", kind: "web" }],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("research snapshot", () => {
  it("roundtrips bundle JSON", () => {
    const ws = tmpWs();
    const b = minimalBundle("task-a");
    const p = persistResearchSnapshot(ws, b);
    expect(p).toBe(researchSnapshotPath(ws, "task-a"));
    const read = readResearchSnapshot(ws, "task-a");
    expect(read?.taskId).toBe("task-a");
    expect(read?.sources[0]?.id).toBe("s1");
  });

  it("returns undefined when missing", () => {
    const ws = tmpWs();
    expect(readResearchSnapshot(ws, "nope")).toBeUndefined();
  });
});
