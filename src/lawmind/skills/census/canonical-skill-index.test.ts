import { describe, expect, it } from "vitest";
import {
  CANONICAL_SKILL_INDEX,
  formatCanonicalSkillIndexCatalog,
  lookupCanonicalSkillIndex,
} from "./canonical-skill-index.js";

describe("canonical-skill-index", () => {
  it("ships metadata only (no third-party bodies)", () => {
    expect(CANONICAL_SKILL_INDEX.length).toBeGreaterThanOrEqual(10);
    for (const e of CANONICAL_SKILL_INDEX) {
      expect(e.id).toBeTruthy();
      expect(e.sourceRepo).toMatch(/\//);
      expect(["absorb", "structure_only", "skip"]).toContain(e.licenseAbsorb);
      expect(e).not.toHaveProperty("body");
    }
  });

  it("formats catalog lines for read_skill", () => {
    const lines = formatCanonicalSkillIndexCatalog(5);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain("规范库");
    expect(lines[0]).toContain("不执行");
  });

  it("looks up by id", () => {
    const hit = lookupCanonicalSkillIndex("panrui-contract-redline");
    expect(hit?.sourceRepo).toContain("pa1nrui1");
    expect(hit?.mapsToCapabilityId).toBe("contract.review");
  });
});
