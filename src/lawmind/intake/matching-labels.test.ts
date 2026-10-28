import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../application/services/matter-write-service.js";
import { attachIntakeItem } from "./filing.js";
import { collectLawyerMatchingCases, evaluateWorkspaceMatching } from "./matching-labels.js";
import { recordIntakeItem } from "./store.js";

const dirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-matching-labels-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function record(dir: string, externalKey: string, subject: string) {
  return recordIntakeItem(dir, {
    channel: "upload",
    externalKey,
    receivedAt: "2026-10-27T00:00:00.000Z",
    subject,
    text: `${subject} 的正文`,
    attachments: [],
  }).item;
}

describe("lawyer matching labels", () => {
  it("uses only lawyer filings as labels and reports what it skipped", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "m1", title: "甲案" });
    createMatterIfMissing(dir, { matterId: "m2", title: "乙案" });

    const lawyerFiled = record(dir, "upload:label", "【m1】补充材料");
    attachIntakeItem(dir, lawyerFiled.id, "m1", { by: "lawyer" });

    const systemFiled = record(dir, "upload:auto", "【m1】系统自动");
    attachIntakeItem(dir, systemFiled.id, "m1", { by: "system" });

    record(dir, "upload:pending", "还没有决定归哪个案");

    const closedFiled = record(dir, "upload:closed", "【m2】已结案");
    attachIntakeItem(dir, closedFiled.id, "m2", { by: "lawyer" });
    await updateMatterProfile(dir, { matterId: "m2", status: "closed" });

    const { cases, source } = collectLawyerMatchingCases(dir);
    expect(cases.map((entry) => entry.item.id)).toEqual([lawyerFiled.id]);
    expect(cases[0]?.expectedMatterId).toBe("m1");
    expect(source).toMatchObject({
      labeled: 1,
      skippedAutoAttached: 1,
      skippedPending: 1,
      skippedClosedMatter: 1,
      scanMayBeTruncated: false,
    });

    const report = evaluateWorkspaceMatching(dir);
    expect(report.total).toBe(1);
    expect(report.falseAttach).toBe(0);
    expect(report.recallAt1).toBe(1);
    expect(report.source.labeled).toBe(1);
  });

  it("returns null rates when the workspace has no lawyer labels", () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "m1", title: "甲案" });
    const item = record(dir, "upload:auto-only", "【m1】自动");
    attachIntakeItem(dir, item.id, "m1", { by: "system" });

    const report = evaluateWorkspaceMatching(dir);
    expect(report.total).toBe(0);
    expect(report.recallAt1).toBeNull();
    expect(report.autoAttachPrecision).toBeNull();
    expect(report.source.skippedAutoAttached).toBe(1);
  });
});
