import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listDeadlinesForMatter,
  recordDeadline,
} from "../application/services/deadline-service.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { processDueDeadlineReminders } from "./deadline-remind.js";

describe("processDueDeadlineReminders", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-remind-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("queues an inbox item once when a hearing is inside the remind window", () => {
    createMatterIfMissing(workspaceDir, { matterId: "m-h", title: "开庭案" });
    recordDeadline(workspaceDir, {
      matterId: "m-h",
      title: "开庭",
      dueAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
      eventKind: "hearing",
      remindBeforeHours: 72,
    });
    const first = processDueDeadlineReminders(workspaceDir);
    expect(first.reminded).toBe(1);
    expect(listDeadlinesForMatter(workspaceDir, "m-h")[0]?.remindedAt).toBeTruthy();
    const second = processDueDeadlineReminders(workspaceDir);
    expect(second.reminded).toBe(0);
  });
});
