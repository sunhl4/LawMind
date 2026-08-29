import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureBuiltinSkillSeeds } from "./ensure-builtin-skill-seeds.js";
import { listLocalSkills } from "./skill-runtime.js";

describe("ensureBuiltinSkillSeeds", () => {
  let ws: string;

  afterEach(() => {
    if (ws) {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("writes signed builtin skills discoverable with signatureOk", () => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-seeds-"));
    const first = ensureBuiltinSkillSeeds(ws);
    expect(first.created.length).toBeGreaterThanOrEqual(3);
    expect(first.created).toContain("contract-redline-craft");
    expect(first.created).toContain("intake-required-inputs");
    expect(first.created).toContain("citation-grounding");

    const listed = listLocalSkills(ws);
    const ids = listed.map((s) => s.id);
    expect(ids).toContain("contract-redline-craft");
    for (const id of ["contract-redline-craft", "intake-required-inputs", "citation-grounding"]) {
      const meta = listed.find((s) => s.id === id);
      expect(meta?.signatureOk).toBe(true);
    }

    const second = ensureBuiltinSkillSeeds(ws);
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThanOrEqual(3);
  });
});
