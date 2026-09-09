import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordDeadline } from "../application/services/deadline-service.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { compileIntakeBrief, confirmIntakeBrief, saveIntakeBrief } from "./intake-brief.js";
import { buildMatterPulse, daysUntilIso, hearingCountdownLabel } from "./matter-pulse.js";

describe("matter pulse", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("aggregates identity, hearing countdown and empty live lists", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-pulse-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, {
      matterId: "case-pulse",
      title: "买卖合同纠纷",
      matterKind: "litigation",
      clientId: "acme",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "case-pulse",
      counterparty: "乙公司",
      causeOfAction: "买卖合同纠纷",
    });
    const due = new Date();
    due.setDate(due.getDate() + 11);
    const dueAt = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}T09:00:00`;
    recordDeadline(workspaceDir, {
      matterId: "case-pulse",
      title: "开庭",
      dueAt,
      eventKind: "hearing",
    });
    const pulse = buildMatterPulse(workspaceDir, "case-pulse");
    expect(pulse?.title).toBe("买卖合同纠纷");
    expect(pulse?.counterparty).toBe("乙公司");
    expect(pulse?.causeOfAction).toBe("买卖合同纠纷");
    expect(pulse?.counts.deadlines).toBe(1);
    expect(pulse?.daysUntilHearing).toBe(11);
    expect(hearingCountdownLabel(pulse?.daysUntilHearing ?? null)).toContain("11");
  });
});

describe("daysUntilIso", () => {
  it("counts whole local days", () => {
    expect(daysUntilIso("1999-01-01T00:00:00", new Date("1999-01-01T18:00:00"))).toBe(0);
  });
});

describe("confirmIntakeBrief", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("stamps confirmedAt", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-brief-"));
    tmp.push(workspaceDir);
    const brief = compileIntakeBrief({
      matterId: "m1",
      workspaceDir,
      transcript: "客户希望解除合同。已付定金未交货。",
    });
    await saveIntakeBrief(workspaceDir, brief);
    const confirmed = await confirmIntakeBrief(workspaceDir, "m1");
    expect(confirmed?.confirmedAt).toBeTruthy();
  });
});
