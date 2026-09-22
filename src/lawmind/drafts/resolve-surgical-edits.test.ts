import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeRedlinePlan } from "./redline-plan.js";
import { resolveSurgicalEditsForApply } from "./resolve-surgical-edits.js";

describe("resolve-surgical-edits", () => {
  let tmp: string | undefined;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("uses explicit edits when provided", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-resolve-edits-"));
    const resolved = resolveSurgicalEditsForApply({
      editsArg: [{ find: "甲", replace: "乙" }],
      workspaceDir: tmp,
      taskId: "t1",
    });
    expect(resolved.fromPlan).toBe(false);
    expect(resolved.edits[0]?.find).toBe("甲");
  });

  it("falls back to redline-plan on unlocked path when edits omitted", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-resolve-edits-"));
    writeRedlinePlan(tmp, {
      taskId: "t2",
      items: [{ find: "无限责任", replace: "责任上限" }],
      skipped: [],
      updatedAt: new Date().toISOString(),
    });
    const resolved = resolveSurgicalEditsForApply({
      editsArg: undefined,
      workspaceDir: tmp,
      taskId: "t2",
    });
    expect(resolved.fromPlan).toBe(true);
    expect(resolved.edits[0]?.find).toBe("无限责任");
  });

  it("does not fall back on mail or Word lock", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lm-resolve-edits-"));
    writeRedlinePlan(tmp, {
      taskId: "t3",
      items: [{ find: "无限责任", replace: "责任上限" }],
      skipped: [],
      updatedAt: new Date().toISOString(),
    });
    expect(() =>
      resolveSurgicalEditsForApply({
        editsArg: undefined,
        workspaceDir: tmp!,
        taskId: "t3",
        mailContractTurn: true,
      }),
    ).toThrow(/edits/);
    expect(() =>
      resolveSurgicalEditsForApply({
        editsArg: undefined,
        workspaceDir: tmp!,
        taskId: "t3",
        wordRevisionTurn: true,
      }),
    ).toThrow(/edits/);
  });
});
