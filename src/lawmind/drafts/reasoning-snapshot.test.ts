import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LegalReasoningGraph } from "../types.js";
import {
  isLegalReasoningGraph,
  persistReasoningSnapshot,
  readReasoningSnapshot,
} from "./reasoning-snapshot.js";

function graph(): LegalReasoningGraph {
  return {
    taskId: "task-snap",
    matterId: "m-1",
    issueTree: [],
    argumentMatrix: [],
    authorityConflicts: [],
    deliveryRisks: [],
    overallConfidence: 0.5,
    builtAt: "2026-09-24T00:00:00.000Z",
  };
}

describe("reasoning snapshot", () => {
  let workspaceDir: string;

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("round-trips a graph and rejects a file that is not a graph", () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-reason-"));
    const written = persistReasoningSnapshot(workspaceDir, graph());
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readdirSync(path.dirname(written)).some((name) => name.includes(".tmp-"))).toBe(
      false,
    );
    expect(readReasoningSnapshot(workspaceDir, "task-snap")?.matterId).toBe("m-1");

    fs.writeFileSync(written, JSON.stringify({ taskId: "task-snap" }), "utf8");
    expect(readReasoningSnapshot(workspaceDir, "task-snap")).toBeUndefined();
    expect(isLegalReasoningGraph({ taskId: "task-snap" })).toBe(false);
  });
});
