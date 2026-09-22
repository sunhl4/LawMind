import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMatterRaid,
  matterTheoryBlocksStrictExport,
  readMatterOpsSummary,
  writeMatterOpsPlan,
  writeMatterOpsScope,
  writeMatterTheoryLite,
} from "./storage.js";

describe("matter-ops storage", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("writes scope/plan/raid and theory gate", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ops-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "matters", "m1"), { recursive: true });
    writeMatterOpsScope(ws, "m1", "审查 MSA 主合同");
    writeMatterOpsPlan(ws, "m1", {
      phases: [{ id: "p1", title: "初审" }],
      milestones: [{ id: "ms1", title: "客户回复", dueAt: "2099-01-01" }],
    });
    appendMatterRaid(ws, "m1", { kind: "risk", text: "责任上限缺失" });
    const summary = readMatterOpsSummary(ws, "m1");
    expect(summary.scope?.baseline).toContain("MSA");
    expect(summary.openRiskCount).toBe(1);
    expect(summary.nextMilestone?.title).toBe("客户回复");

    expect(matterTheoryBlocksStrictExport(ws, "m1", { requireAnchor: true })).toBe(true);
    writeMatterTheoryLite(ws, "m1", {
      issues: "违约责任争点",
      authorities: "合同法相关",
      openQuestions: "赔偿上限是否可谈",
      anchored: true,
    });
    expect(matterTheoryBlocksStrictExport(ws, "m1", { requireAnchor: true })).toBe(false);
  });
});
