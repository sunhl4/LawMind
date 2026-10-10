import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendDailyPlanItems,
  listOpenLawyerPlanItemsBefore,
  loadDailyPlan,
  localDateKey,
  markDailyPlanSourceDone,
  deleteDailyPlanItem,
  patchDailyPlanItem,
  setDailyPlanItemDone,
  setDailyPlanSourceDone,
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
    const yesterday = await appendDailyPlanItems(workspaceDir, ["改代理词"], {
      date: "2026-09-16",
    });
    await appendDailyPlanItems(workspaceDir, ["法院来件"], {
      date: "2026-09-16",
      source: "mail",
    });
    await appendDailyPlanItems(workspaceDir, ["今天新写的"], { date: "2026-09-17" });
    const carried = listOpenLawyerPlanItemsBefore(workspaceDir, "2026-09-17");
    expect(carried.items.map((item) => item.text)).toEqual(["改代理词"]);
    expect(carried.omitted).toBe(0);
    expect(carried.items[0]?.originDate).toBe("2026-09-16");
    expect(loadDailyPlan(workspaceDir, "2026-09-17").items.map((item) => item.text)).toEqual([
      "今天新写的",
    ]);

    const done = await setDailyPlanItemDone(
      workspaceDir,
      yesterday.items[0].id,
      true,
      "2026-09-16",
    );
    expect(done?.date).toBe("2026-09-16");
    expect(done?.items[0]?.done).toBe(true);
    expect(listOpenLawyerPlanItemsBefore(workspaceDir, "2026-09-17")).toEqual({
      items: [],
      omitted: 0,
    });
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
    expect(carried.items.map((item) => item.text)).toEqual(["昨天的"]);
    expect(carried.omitted).toBe(0);
  });

  it("upserts a done sentinel when marking a mail source that has no plan row", async () => {
    const date = "2026-10-10";
    const plan = await markDailyPlanSourceDone(workspaceDir, "mail", "msg-new", date);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.source).toBe("mail");
    expect(plan.items[0]?.sourceRef).toBe("msg-new");
    expect(plan.items[0]?.done).toBe(true);
  });

  it("can unmark a mail source when needed", async () => {
    const date = "2026-10-10";
    await setDailyPlanSourceDone(workspaceDir, "mail", "msg-undo", true, date);
    const reopened = await setDailyPlanSourceDone(workspaceDir, "mail", "msg-undo", false, date);
    expect(reopened.items.find((item) => item.sourceRef === "msg-undo")?.done).toBe(false);
  });

  it("patches matterId onto an existing plan row", async () => {
    const saved = await appendDailyPlanItems(workspaceDir, ["回电王总"], { date: "2026-10-10" });
    const patched = await patchDailyPlanItem(
      workspaceDir,
      saved.items[0].id,
      { matterId: "case-link" },
      "2026-10-10",
    );
    expect(patched?.items[0]?.matterId).toBe("case-link");
  });

  it("deletes a plan row from the day file", async () => {
    const saved = await appendDailyPlanItems(workspaceDir, ["过时备忘"], { date: "2026-10-10" });
    const after = await deleteDailyPlanItem(workspaceDir, saved.items[0].id, "2026-10-10");
    expect(after?.items).toHaveLength(0);
  });
});
