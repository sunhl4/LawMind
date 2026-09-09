import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach } from "vitest";
import { recordDeadline } from "../application/services/deadline-service.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { appendDailyPlanItems } from "./daily-plan.js";
import { buildTodayWorkSnapshot } from "./today-work.js";

describe("buildTodayWorkSnapshot", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-today-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("includes lawyer plan items and open hearings", async () => {
    createMatterIfMissing(workspaceDir, {
      matterId: "m-today",
      title: "开庭案",
      matterKind: "litigation",
    });
    await appendDailyPlanItems(workspaceDir, ["回复客户"], {
      date: new Date().toISOString().slice(0, 10),
    });
    recordDeadline(workspaceDir, {
      matterId: "m-today",
      title: "开庭",
      dueAt: new Date(Date.now() + 3600_000).toISOString(),
      eventKind: "hearing",
    });
    const snap = buildTodayWorkSnapshot(workspaceDir);
    expect(snap.items.some((i) => i.kind === "plan" && i.title.includes("回复客户"))).toBe(true);
    expect(snap.items.some((i) => i.kind === "deadline" && i.title.includes("开庭"))).toBe(true);
    expect(snap.progress.total).toBeGreaterThan(0);
  });
});
