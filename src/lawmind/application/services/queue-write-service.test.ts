/**
 * Queue write service — smoke tests for open / transition.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listQueueItemsForMatter,
  openQueueItem,
  transitionQueueItem,
  type QueueItemRecord,
} from "./queue-write-service.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(HERE, "queue-transition-worker.mjs");

function transitionInChild(input: {
  workspaceDir: string;
  matterId: string;
  queueItemId: string;
  status: string;
}): Promise<QueueItemRecord | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        WORKER_PATH,
        input.workspaceDir,
        input.matterId,
        input.queueItemId,
        input.status,
      ],
      { cwd: path.resolve(HERE, "../../../.."), env: process.env },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}: ${err}`));
        return;
      }
      try {
        resolve(out ? (JSON.parse(out) as QueueItemRecord) : null);
      } catch (e) {
        reject(
          new Error(
            `worker parse: ${e instanceof Error ? e.message : String(e)}\nout=${out}\nerr=${err}`,
          ),
        );
      }
    });
  });
}

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

  it("true concurrent transition of two different items under lock: both survive", async () => {
    // Without the file lock, two concurrent RMW on queue.jsonl would race:
    // each reads the full array, mutates its own item, and rewrites — last write wins,
    // losing the other item's transition. The lock serializes them so both persist.
    const a = openQueueItem(workspaceDir, {
      matterId: "m-race",
      kind: "need_lawyer_review",
      title: "条目 A",
    });
    const b = openQueueItem(workspaceDir, {
      matterId: "m-race",
      kind: "need_evidence",
      title: "条目 B",
    });

    const results = await Promise.all([
      transitionInChild({
        workspaceDir,
        matterId: "m-race",
        queueItemId: a.queueItemId,
        status: "resolved",
      }),
      transitionInChild({
        workspaceDir,
        matterId: "m-race",
        queueItemId: b.queueItemId,
        status: "resolved",
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r?.status === "resolved")).toBe(true);
    const resolved = listQueueItemsForMatter(workspaceDir, "m-race", { status: "resolved" });
    expect(resolved).toHaveLength(2);
    expect(new Set(resolved.map((r) => r.queueItemId))).toEqual(
      new Set([a.queueItemId, b.queueItemId]),
    );
  });
});
