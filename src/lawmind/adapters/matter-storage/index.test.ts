/**
 * Matter storage adapter — smoke tests for JSON / JSONL truth source IO.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendApproval,
  appendDeadline,
  loadMatter,
  readApprovals,
  readDeadlines,
  rewriteApprovals,
  saveMatter,
  type ApprovalRecord,
  type DeadlineRecord,
  type MatterRecord,
} from "./index.js";

describe("adapters/matter-storage", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-matter-storage-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  function sampleMatter(matterId = "m-storage-1"): MatterRecord {
    const now = new Date().toISOString();
    return {
      matterId,
      title: "Storage smoke",
      status: "active",
      sensitivity: "normal",
      strategyStatus: "missing",
      openQuestionIds: [],
      nextActions: [],
      deadlineIds: [],
      deliverableIds: [],
      queueItemIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  it("saveMatter / loadMatter round-trips validated JSON", () => {
    const matter = sampleMatter();
    saveMatter(workspaceDir, matter);
    expect(loadMatter(workspaceDir, matter.matterId)).toEqual(matter);
  });

  it("rejects invalid matter payloads before write", () => {
    expect(() =>
      saveMatter(workspaceDir, {
        ...sampleMatter(),
        status: "not-a-status",
      } as unknown as MatterRecord),
    ).toThrow();
    expect(loadMatter(workspaceDir, "m-storage-1")).toBeUndefined();
  });

  it("appendApproval / rewriteApprovals updates JSONL status", () => {
    const matterId = "m-appr";
    saveMatter(workspaceDir, sampleMatter(matterId));
    const pending: ApprovalRecord = {
      approvalId: "ap-1",
      matterId,
      requestedBy: "lawyer:test",
      requestedAt: new Date().toISOString(),
      reason: "签批测试",
      riskLevel: "medium",
      status: "pending",
    };
    appendApproval(workspaceDir, pending);
    expect(readApprovals(workspaceDir, matterId)).toHaveLength(1);

    rewriteApprovals(workspaceDir, matterId, [
      {
        ...pending,
        status: "approved",
        resolvedBy: "lawyer:test",
        resolvedAt: new Date().toISOString(),
      },
    ]);
    const rows = readApprovals(workspaceDir, matterId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("approved");
  });

  it("skips corrupt JSONL lines while retaining valid deadline rows", () => {
    const matterId = "m-dl";
    saveMatter(workspaceDir, sampleMatter(matterId));
    const good: DeadlineRecord = {
      deadlineId: "dl-1",
      matterId,
      title: "举证期限",
      dueAt: "2026-08-01T00:00:00.000Z",
      severity: "hard",
      source: "manual",
      status: "open",
    };
    appendDeadline(workspaceDir, good);
    const file = path.join(workspaceDir, "matters", matterId, "deadlines.jsonl");
    fs.appendFileSync(file, "{not-json\n", "utf8");
    const second: DeadlineRecord = {
      ...good,
      deadlineId: "dl-2",
      title: "开庭",
    };
    appendDeadline(workspaceDir, second);

    const rows = readDeadlines(workspaceDir, matterId);
    expect(rows.map((r) => r.deadlineId)).toEqual(["dl-1", "dl-2"]);
  });
});
