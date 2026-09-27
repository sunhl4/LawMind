import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN_SKILL_SEED_IDS, ensureBuiltinSkillSeeds } from "./ensure-builtin-skill-seeds.js";
import { productPlaybookIds } from "./product-playbooks.js";
import { listLocalSkills, skillSignatureSecret, verifySkillSignature } from "./skill-runtime.js";

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
    expect(first.created).toContain("practice-defaults");
    expect(first.created).toContain("labor-compensation-calc");
    expect(first.created).toContain("invoice-organizer");
    expect(first.created).toContain("ip-dispute-route");
    expect(first.created).toContain("matter-status-report");
    expect(first.created).toContain("family-matter-route");
    expect(first.created).toContain("capital-markets-route");
    expect(first.created).toContain("governance-route");
    expect(first.created).toContain("ads-compliance-route");
    expect(first.created).toContain("criminal-stage-route");
    expect(ids).toContain("quick-legal-triage");
    for (const id of ["contract-redline-craft", "intake-required-inputs", "citation-grounding"]) {
      const meta = listed.find((s) => s.id === id);
      expect(meta?.signatureOk).toBe(true);
    }

    const second = ensureBuiltinSkillSeeds(ws);
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThanOrEqual(3);
  });

  it("signs with the secret the caller resolved, not a guessed one", () => {
    // 回归：`lawmind-local-server` 曾在加载 `.env.lawmind` **之前**调用本函数，
    // 于是 seed 用「按路径派生」的兜底值签名，而消费方用 env 密钥验签 ⇒ 全部 Skill 静默失效。
    // 现在密钥由调用方显式传入，这条测试盯住「传进来的那个就是签下去的那个」。
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-seeds-"));
    const viaEnv = "env-secret-for-this-workspace";
    const seeded = ensureBuiltinSkillSeeds(ws, { secret: viaEnv });
    expect(seeded.created.length).toBeGreaterThan(0);

    const skillDir = path.join(ws, "lawmind", "skills", seeded.created[0]);
    const body = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
    const sig = fs.readFileSync(path.join(skillDir, "SKILL.sig"), "utf8").trim();
    expect(verifySkillSignature(body, sig, viaEnv).ok).toBe(true);
    // 用「派生的兜底值」验同一份签名必须失败（否则说明它根本没听调用方）。
    expect(verifySkillSignature(body, sig, skillSignatureSecret(ws)).ok).toBe(false);
  });

  it("seeds every product playbook file", () => {
    const seeded = new Set<string>(BUILTIN_SKILL_SEED_IDS);
    for (const id of productPlaybookIds()) {
      expect(seeded.has(id), id).toBe(true);
    }
    expect(seeded.size).toBe(productPlaybookIds().length);
  });
});
