import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  approvalsJsonlPath,
  assertSafeMatterId,
  campaignDirPath,
  deadlinesJsonlPath,
  deliverableJsonPath,
  matterDir,
  matterJsonPath,
  matterStorageRoot,
  queueJsonlPath,
  triageDirPath,
} from "./paths.js";

describe("matter-storage paths", () => {
  it("keeps matter files under workspace/matters/<id>/", () => {
    const ws = "/tmp/lm-ws";
    const mid = "matter-a";
    expect(matterStorageRoot(ws)).toBe(path.join(ws, "matters"));
    expect(matterDir(ws, mid)).toBe(path.join(ws, "matters", mid));
    expect(matterJsonPath(ws, mid)).toBe(path.join(ws, "matters", mid, "matter.json"));
    expect(deliverableJsonPath(ws, mid, "d1")).toBe(
      path.join(ws, "matters", mid, "deliverables", "d1.json"),
    );
    expect(approvalsJsonlPath(ws, mid)).toContain("approvals.jsonl");
    expect(queueJsonlPath(ws, mid)).toContain("queue.jsonl");
    expect(deadlinesJsonlPath(ws, mid)).toContain("deadlines.jsonl");
    expect(triageDirPath(ws, mid)).toContain(path.join("matters", mid, "triage"));
    expect(campaignDirPath(ws, mid)).toContain(path.join("matters", mid, "campaigns"));
  });

  it("rejects unsafe matter ids", () => {
    expect(() => assertSafeMatterId("../evil")).toThrow(/unsafe matter id/);
    expect(assertSafeMatterId("matter_1")).toBe("matter_1");
  });
});
