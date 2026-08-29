import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLawyerWork } from "../work/store.js";
import {
  buildAutomationInstructionFromWork,
  createAutomationFromWork,
  presetFromCapability,
} from "./automation-from-work.js";
import { listAutomations } from "./lawyer-automations.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("automation-from-work", () => {
  it("locks mail.contract onto the mail-contract-review preset", () => {
    expect(presetFromCapability("mail.contract")).toBe("mail-contract-review");
    const built = buildAutomationInstructionFromWork({
      title: "供货合同",
      goal: "按附件审查",
      capabilityId: "contract.review",
    });
    expect(built.instruction).toContain("【办件】能力：contract.review");
    expect(built.title).toContain("例行");
  });

  it("creates a weekly automation from a work record", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-work-"));
    dirs.push(ws);
    const work = createLawyerWork(ws, {
      title: "审查供货合同",
      goal: "【办件】能力：contract.review\n按附件审查",
      matterId: "matter-acme",
      source: "chat",
      capabilityId: "contract.review",
    });
    const automation = createAutomationFromWork(ws, work);
    expect(automation.matterId).toBe("matter-acme");
    expect(automation.schedule.kind).toBe("weekly");
    expect(automation.instruction).toContain("contract.review");
    expect(listAutomations(ws)).toHaveLength(1);
  });

  it("rejects work without a matter", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-auto-work-nomatter-"));
    dirs.push(ws);
    const work = createLawyerWork(ws, {
      title: "无案件",
      goal: "审查",
      source: "chat",
    });
    expect(() => createAutomationFromWork(ws, work)).toThrow("work_missing_matter");
  });
});
