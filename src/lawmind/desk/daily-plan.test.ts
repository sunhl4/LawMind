import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendDailyPlanItems,
  listOpenLawyerPlanItemsBefore,
  loadDailyPlan,
  localDateKey,
  setDailyPlanItemDone,
  shiftLocalDateKey,
} from "./daily-plan.js";

describe("daily-plan", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-daily-plan-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("appends lawyer items and toggles done", async () => {
    const saved = await appendDailyPlanItems(workspaceDir, ["回复客户函", "改租赁合同"], {
      date: "2026-09-09",
    });
    expect(saved.items).toHaveLength(2);
    expect(saved.items[0]?.done).toBe(false);
    const next = await setDailyPlanItemDone(workspaceDir, saved.items[0].id, true, "2026-09-09");
    expect(next?.items[0]?.done).toBe(true);
    expect(loadDailyPlan(workspaceDir, "2026-09-09").items[1]?.text).toBe("改租赁合同");
  });

  it("lists unfinished lawyer items from prior days without copying them", async () => {
    const yesterday = await appendDailyPlanItems(workspaceDir, ["改代理词"], { date: "2026-09-16" });
    await appendDailyPlanItems(workspaceDir, ["法院来件"], {
      date: "2026-09-16",
      source: "mail",
    });
    await appendDailyPlanItems(workspaceDir, ["今天新写的"], { date: "2026-09-17" });
    const carried = listOpenLawyerPlanItemsBefore(workspaceDir, "2026-09-17");
    expect(carried.map((item) => item.text)).toEqual(["改代理词"]);
    expect(carried[0]?.originDate).toBe("2026-09-16");
    expect(loadDailyPlan(workspaceDir, "2026-09-17").items.map((item) => item.text)).toEqual(["今天新写的"]);

    const done = await setDailyPlanItemDone(workspaceDir, yesterday.items[0].id, true, "2026-09-16");
    expect(done?.date).toBe("2026-09-16");
    expect(done?.items[0]?.done).toBe(true);
    expect(listOpenLawyerPlanItemsBefore(workspaceDir, "2026-09-17")).toEqual([]);
  });

  it("completes a yesterday item without the caller passing the origin date", async () => {
    const today = localDateKey();
    const yesterday = shiftLocalDateKey(today, -1);
    const saved = await appendDailyPlanItems(workspaceDir, ["跨天补勾"], { date: yesterday });
    const next = await setDailyPlanItemDone(workspaceDir, saved.items[0].id, true);
    expect(next?.date).toBe(yesterday);
    expect(loadDailyPlan(workspaceDir, yesterday).items[0]?.done).toBe(true);
    expect(loadDailyPlan(workspaceDir, today).items).toHaveLength(0);
  });

  it("caps carried items and skips days outside the lookback window", async () => {
    await appendDailyPlanItems(workspaceDir, ["十五天前"], { date: "2026-09-02" });
    await appendDailyPlanItems(workspaceDir, ["昨天的"], { date: "2026-09-16" });
    const carried = listOpenLawyerPlanItemsBefore(workspaceDir, "2026-09-17", {
      lookbackDays: 14,
      maxItems: 8,
    });
    expect(carried.map((item) => item.text)).toEqual(["昨天的"]);
  });
});
