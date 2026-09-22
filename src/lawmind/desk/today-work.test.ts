import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { afterEach, beforeEach } from "vitest";
import { completeDeadline, recordDeadline } from "../application/services/deadline-service.js";
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

  it("surfaces unfinished lawyer plans from yesterday with originDate", async () => {
    const now = new Date(2026, 8, 17, 10, 0, 0);
    await appendDailyPlanItems(workspaceDir, ["昨天没写完的代理词"], { date: "2026-09-16" });
    await appendDailyPlanItems(workspaceDir, ["今天的计划"], { date: "2026-09-17" });
    const snap = buildTodayWorkSnapshot(workspaceDir, now);
    const carried = snap.items.find((i) => i.title.includes("昨天没写完"));
    expect(carried?.kind).toBe("plan");
    expect(carried?.originDate).toBe("2026-09-16");
    expect(carried?.done).toBe(false);
    const todayPlan = snap.items.find((i) => i.title.includes("今天的计划"));
    expect(todayPlan?.originDate).toBeUndefined();
  });

  it("keeps gated non-hearing deadlines off today until the predecessor completes", () => {
    createMatterIfMissing(workspaceDir, { matterId: "m-gate", title: "链条案" });
    const hearing = recordDeadline(workspaceDir, {
      matterId: "m-gate",
      title: "开庭",
      dueAt: new Date(Date.now() + 2 * 24 * 3600_000).toISOString(),
      eventKind: "hearing",
    });
    recordDeadline(workspaceDir, {
      matterId: "m-gate",
      title: "上诉期限",
      dueAt: new Date().toISOString(),
      eventKind: "limitation",
      dependsOnDeadlineId: hearing.deadlineId,
    });
    const blocked = buildTodayWorkSnapshot(workspaceDir);
    expect(blocked.items.some((i) => i.title.includes("上诉期限"))).toBe(false);
    expect(blocked.items.some((i) => i.title.includes("开庭"))).toBe(true);

    completeDeadline(workspaceDir, "m-gate", hearing.deadlineId);
    const released = buildTodayWorkSnapshot(workspaceDir);
    expect(released.items.some((i) => i.title.includes("上诉期限"))).toBe(true);
  });
});
