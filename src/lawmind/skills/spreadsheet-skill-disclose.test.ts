import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectEnabledSkillToolNames } from "../agent/tools/disclosed-turn-tools.js";
import { ensureBuiltinSkillSeeds } from "./ensure-builtin-skill-seeds.js";
import { listLocalSkills, writeSkillEnabled } from "./skill-runtime.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("spreadsheet-analysis skill disclosure", () => {
  it("discloses analyze_spreadsheet when enabled and not when disabled", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-ss-"));
    dirs.push(ws);
    ensureBuiltinSkillSeeds(ws);
    const listed = listLocalSkills(ws);
    const skill = listed.find((s) => s.id === "spreadsheet-analysis");
    expect(skill?.toolNames).toContain("analyze_spreadsheet");
    expect(skill?.signatureOk).toBe(true);

    writeSkillEnabled(ws, "spreadsheet-analysis", true);
    expect(collectEnabledSkillToolNames(ws)).toContain("analyze_spreadsheet");

    writeSkillEnabled(ws, "spreadsheet-analysis", false);
    expect(collectEnabledSkillToolNames(ws)).not.toContain("analyze_spreadsheet");
  });
});
