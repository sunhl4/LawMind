import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLawyerWork, workEventsPath } from "../work/store.js";
import { classifyRejectionLabels, recordRejectionRatchet } from "./rejection-ratchet.js";

describe("rejection-ratchet", () => {
  it("maps citation labels to verify and skips bare reject", () => {
    expect(classifyRejectionLabels([])).toBeNull();
    expect(classifyRejectionLabels(["引用有误"])).toBe("verify");
    expect(classifyRejectionLabels(["模板不匹配"])).toBe("template");
    expect(classifyRejectionLabels(["语气过强"])).toBe("skill");
    expect(classifyRejectionLabels(["争点遗漏"])).toBe("playbook");
  });

  it("writes a work event only when labels exist", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ratchet-"));
    const work = createLawyerWork(ws, {
      title: "合同审查",
      goal: "审合同",
      taskId: "t-1",
      source: "chat",
    });
    expect(
      recordRejectionRatchet({
        workspaceDir: ws,
        taskId: "t-1",
        status: "rejected",
        labels: [],
      }),
    ).toBeNull();
    const recorded = recordRejectionRatchet({
      workspaceDir: ws,
      taskId: "t-1",
      status: "rejected",
      labels: ["引用有误"],
      note: "法条号不对",
    });
    expect(recorded).toEqual({ class: "verify", workId: work.workId });
    const events = fs.readFileSync(workEventsPath(ws, work.workId), "utf8");
    expect(events).toContain("rejection_ratchet");
    expect(events).toContain("verify");
  });
});
