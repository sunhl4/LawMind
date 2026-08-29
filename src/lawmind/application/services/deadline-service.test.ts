/**
 * Deadline service — record / status transitions / append-vs-rewrite 并发冒烟。
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeDeadline,
  listDeadlinesForMatter,
  recordDeadline,
  snoozeDeadline,
  type DeadlineRecord,
} from "./deadline-service.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORD_WORKER_PATH = path.join(HERE, "deadline-record-worker.mjs");

function recordInChild(input: {
  workspaceDir: string;
  matterId: string;
  title: string;
  dueAt: string;
}): Promise<DeadlineRecord | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        RECORD_WORKER_PATH,
        input.workspaceDir,
        input.matterId,
        input.title,
        input.dueAt,
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
        reject(new Error(`record worker exit ${code}: ${err}`));
        return;
      }
      try {
        resolve(out ? (JSON.parse(out) as DeadlineRecord) : null);
      } catch (e) {
        reject(
          new Error(
            `record worker parse: ${e instanceof Error ? e.message : "error"}\nout=${out}\nerr=${err}`,
          ),
        );
      }
    });
  });
}

describe("deadline-service", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-deadline-svc-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("record → list → complete → snooze", () => {
    const rec = recordDeadline(workspaceDir, {
      matterId: "m-d1",
      title: "举证期限",
      dueAt: "2026-08-15T00:00:00.000Z",
      severity: "hard",
    });
    expect(rec.status).toBe("open");
    expect(listDeadlinesForMatter(workspaceDir, "m-d1")).toHaveLength(1);

    const snoozed = snoozeDeadline(
      workspaceDir,
      "m-d1",
      rec.deadlineId,
      "2026-08-20T00:00:00.000Z",
    );
    expect(snoozed?.status).toBe("snoozed");
    expect(snoozed?.dueAt).toBe("2026-08-20T00:00:00.000Z");

    const done = completeDeadline(workspaceDir, "m-d1", rec.deadlineId);
    expect(done?.status).toBe("completed");
  });

  it("concurrent record (append) and complete (locked rewrite): both entries survive", async () => {
    // append 与 rewrite 共用同一把锁前，「新建期限 + 完成旧期限」并发会让
    // rewrite 用旧快照覆盖 append 后的文件，静默丢掉新建期限。
    const existing = recordDeadline(workspaceDir, {
      matterId: "m-append-race",
      title: "待完成期限",
      dueAt: "2026-08-10T00:00:00.000Z",
    });

    const [recordedInChild] = await Promise.all([
      recordInChild({
        workspaceDir,
        matterId: "m-append-race",
        title: "并发新建期限",
        dueAt: "2026-09-01T00:00:00.000Z",
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 30));
        completeDeadline(workspaceDir, "m-append-race", existing.deadlineId);
      })(),
    ]);

    expect(recordedInChild?.deadlineId).toBeTruthy();
    const all = listDeadlinesForMatter(workspaceDir, "m-append-race");
    expect(all).toHaveLength(2);
    expect(all.some((d) => d.deadlineId === existing.deadlineId && d.status === "completed")).toBe(
      true,
    );
    expect(
      all.some((d) => d.deadlineId === recordedInChild!.deadlineId && d.status === "open"),
    ).toBe(true);
  });
});
