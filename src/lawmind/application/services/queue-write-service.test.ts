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
const OPEN_WORKER_PATH = path.join(HERE, "queue-open-worker.mjs");

function openInChild(input: {
  workspaceDir: string;
  matterId: string;
  kind: string;
  title: string;
}): Promise<QueueItemRecord | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        OPEN_WORKER_PATH,
        input.workspaceDir,
        input.matterId,
        input.kind,
        input.title,
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
        reject(new Error(`open worker exit ${code}: ${err}`));
        return;
      }
      try {
        resolve(out ? (JSON.parse(out) as QueueItemRecord) : null);
      } catch (e) {
        reject(
          new Error(
            `open worker parse: ${e instanceof Error ? e.message : "error"}\nout=${out}\nerr=${err}`,
          ),
        );
      }
    });
  });
}

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
            `worker parse: ${e instanceof Error ? e.message : "error"}\nout=${out}\nerr=${err}`,
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

  it("concurrent append (open) and locked rewrite (transition): both entries survive", async () => {
    // append 与 rewrite 共用同一把锁前，「开新项 + 解析旧项」并发会让 rewrite
    // 用旧快照覆盖 append 后的文件，静默丢掉新条目。
    const existing = openQueueItem(workspaceDir, {
      matterId: "m-append-race",
      kind: "need_lawyer_review",
      title: "待解析条目",
    });

    const [openedInChild] = await Promise.all([
      openInChild({
        workspaceDir,
        matterId: "m-append-race",
        kind: "need_evidence",
        title: "并发新条目",
      }),
      (async () => {
        // 让子进程先进 critical section 的概率更高：稍等再解析旧条目。
        await new Promise((r) => setTimeout(r, 30));
        transitionQueueItem(workspaceDir, "m-append-race", existing.queueItemId, "resolved");
      })(),
    ]);

    expect(openedInChild?.queueItemId).toBeTruthy();
    const all = listQueueItemsForMatter(workspaceDir, "m-append-race");
    expect(all).toHaveLength(2);
    expect(all.some((q) => q.queueItemId === existing.queueItemId && q.status === "resolved")).toBe(
      true,
    );
    expect(
      all.some((q) => q.queueItemId === openedInChild!.queueItemId && q.status === "open"),
    ).toBe(true);
  });
});
