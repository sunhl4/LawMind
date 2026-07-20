/**
 * Queue write service — smoke tests for open / transition.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listQueueItemsForMatter,
  openQueueItem,
  transitionQueueItem,
} from "./queue-write-service.js";

describe("queue-write-service", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-queue-write-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("openQueueItem persists an open item and transitionQueueItem updates status", () => {
    const opened = openQueueItem(workspaceDir, {
      matterId: "m-q1",
      kind: "need_lawyer_review",
      title: "待签批",
      priority: "high",
    });
    expect(opened.status).toBe("open");
    expect(listQueueItemsForMatter(workspaceDir, "m-q1")).toHaveLength(1);

    const next = transitionQueueItem(workspaceDir, "m-q1", opened.queueItemId, "resolved");
    expect(next?.status).toBe("resolved");
    expect(listQueueItemsForMatter(workspaceDir, "m-q1", { status: "resolved" })).toHaveLength(1);
  });

  it("openQueueItem records blockedReason when dependsOn is unresolved", () => {
    const blocker = openQueueItem(workspaceDir, {
      matterId: "m-q2",
      kind: "need_evidence",
      title: "先补证据",
    });
    const blocked = openQueueItem(workspaceDir, {
      matterId: "m-q2",
      kind: "ready_to_draft",
      title: "再起草",
      dependsOn: [blocker.queueItemId],
    });
    expect(blocked.blockedReason).toContain(blocker.queueItemId);
  });
});
