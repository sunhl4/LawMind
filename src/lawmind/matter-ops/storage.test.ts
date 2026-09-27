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

    const opsDir = path.join(ws, "matters", "m1", "ops");
    expect(fs.readdirSync(opsDir).some((name) => name.includes(".tmp-"))).toBe(false);
    expect(fs.existsSync(path.join(opsDir, "scope.json.lock"))).toBe(false);
  });

  it("keeps scope history, skips a torn raid line, and refuses a bad kind", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ops-"));
    dirs.push(ws);
    writeMatterOpsScope(ws, "m1", "第一版基线");
    writeMatterOpsScope(ws, "m1", "第二版基线");
    const summary = readMatterOpsSummary(ws, "m1");
    expect(summary.scope?.baseline).toBe("第二版基线");
    expect(summary.scope?.changes?.map((change) => change.note)).toEqual(["基线更新：第一版基线"]);

    const raidPath = path.join(ws, "matters", "m1", "ops", "raid.jsonl");
    fs.appendFileSync(raidPath, "not-json\n", "utf8");
    appendMatterRaid(ws, "m1", { kind: "risk", text: "管辖条款缺失" });
    expect(readMatterOpsSummary(ws, "m1").openRiskCount).toBe(1);
    expect(() =>
      appendMatterRaid(ws, "m1", {
        kind: "nope" as "risk",
        text: "不该落盘",
      }),
    ).toThrow();
    expect(fs.readFileSync(raidPath, "utf8")).not.toContain("不该落盘");
  });

  it("keeps an older open risk visible after newer closed notes fill the window", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ops-"));
    dirs.push(ws);
    appendMatterRaid(ws, "m1", { kind: "risk", text: "时效将届满" });
    for (let i = 0; i < 14; i += 1) {
      appendMatterRaid(ws, "m1", { kind: "decision", text: `决定 ${i}`, status: "closed" });
    }
    const summary = readMatterOpsSummary(ws, "m1");
    expect(summary.openRiskCount).toBe(1);
    expect(summary.raidRecent.some((row) => row.text === "时效将届满")).toBe(true);
  });

  it("refuses to overwrite a torn scope file", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ops-"));
    dirs.push(ws);
    writeMatterOpsScope(ws, "m1", "完整基线");
    const scopePath = path.join(ws, "matters", "m1", "ops", "scope.json");
    fs.writeFileSync(scopePath, "{", "utf8");
    expect(() => writeMatterOpsScope(ws, "m1", "新基线")).toThrow(/matter_ops_corrupt:scope.json/);
    expect(fs.readFileSync(scopePath, "utf8")).toBe("{");
  });
});
