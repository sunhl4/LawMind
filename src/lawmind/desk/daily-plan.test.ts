import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendDailyPlanItems, loadDailyPlan, setDailyPlanItemDone } from "./daily-plan.js";

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
});
