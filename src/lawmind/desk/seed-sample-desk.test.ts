import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMatterPulse } from "./matter-pulse.js";
import { seedSampleDesk, SAMPLE_LITIGATION_MATTER_ID } from "./seed-sample-desk.js";
import { buildTodayWorkSnapshot } from "./today-work.js";

describe("seedSampleDesk", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("fills a live litigation file the desk can open", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sample-desk-"));
    tmp.push(workspaceDir);
    const now = new Date(2026, 8, 9, 10, 0, 0);
    await seedSampleDesk(workspaceDir, now);
    const pulse = buildMatterPulse(workspaceDir, SAMPLE_LITIGATION_MATTER_ID, now);
    expect(pulse?.title).toContain("星辉精密");
    expect(pulse?.counterparty).toBe("环宇科技股份有限公司");
    expect(pulse?.parties.some((row) => row.role === "client" && row.serviceAddress)).toBe(true);
    expect(pulse?.causeOfAction).toBe("买卖合同纠纷");
    expect(pulse?.daysUntilHearing).toBe(9);
    expect(pulse?.counts.deadlines).toBeGreaterThanOrEqual(3);
    expect(pulse?.deadlines.some((d) => d.title === "上诉期限" && d.released === false)).toBe(true);
    expect(
      pulse?.deadlines.some((d) => d.title === "上诉期限" && d.sourceLabel === "传票抽取"),
    ).toBe(true);
    expect(pulse?.documents.some((d) => d.title.includes("起诉状"))).toBe(true);
    expect(pulse?.mail.some((m) => m.label === "court")).toBe(true);
    expect(pulse?.mail.some((m) => m.label === "needs_reply")).toBe(true);
    expect(pulse?.counts.approvals).toBeGreaterThanOrEqual(1);
    expect(pulse?.materials.some((row) => row.fileName.includes("合同"))).toBe(true);
    expect(pulse?.timeline.some((row) => row.kind === "hearing")).toBe(true);
    expect(pulse?.timeline.some((row) => row.kind === "mail")).toBe(true);
    expect(pulse?.timeline.some((row) => row.kind === "document")).toBe(true);

    const today = buildTodayWorkSnapshot(workspaceDir, now);
    expect(today.items.some((i) => i.kind === "mail" && i.title.includes("要点"))).toBe(true);
    expect(today.items.some((i) => i.kind === "deadline" && i.title.includes("补充证据"))).toBe(
      true,
    );
    expect(today.items.some((i) => i.kind === "plan" && i.title.includes("证据清单"))).toBe(true);
  });
});
