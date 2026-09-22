import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listLocalSkills,
  resolveSkillSigningSecretSource,
  signSkillBody,
  skillSignatureSecret,
  verifySkillSignature,
  writeSkillEnabled,
} from "./skill-runtime.js";

describe("skill-runtime", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("reports where the signing secret came from (derived is not a trust anchor)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "lawmind", "skills", "demo"), { recursive: true });
    // 先清掉环境变量：否则本机若已设过 LAWMIND_SKILL_SIGNING_SECRET，这条测试会假失败。
    const prev = process.env.LAWMIND_SKILL_SIGNING_SECRET;
    delete process.env.LAWMIND_SKILL_SIGNING_SECRET;
    try {
      // 什么都没有时只能按路径派生——公开算法 + 已知路径 ⇒ 不是秘密。
      expect(resolveSkillSigningSecretSource(ws).source).toBe("derived");
      fs.writeFileSync(path.join(ws, "lawmind", "skills", ".signing-secret"), "file-secret\n");
      expect(resolveSkillSigningSecretSource(ws)).toEqual({
        secret: "file-secret",
        source: "file",
      });
      process.env.LAWMIND_SKILL_SIGNING_SECRET = "env-secret";
      expect(resolveSkillSigningSecretSource(ws)).toEqual({ secret: "env-secret", source: "env" });
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_SKILL_SIGNING_SECRET;
      } else {
        process.env.LAWMIND_SKILL_SIGNING_SECRET = prev;
      }
    }
  });

  it("rejects tampered signature and accepts valid", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-"));
    dirs.push(ws);
    const dir = path.join(ws, "lawmind", "skills", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(ws, "lawmind", "skills", ".signing-secret"), "test-secret\n");
    const body = `---\nid: demo\nname: Demo\nversion: "1"\ndescription: x\n---\n\n# Demo\n`;
    fs.writeFileSync(path.join(dir, "SKILL.md"), body);
    const secret = skillSignatureSecret(ws);
    fs.writeFileSync(path.join(dir, "SKILL.sig"), signSkillBody(body, secret));
    expect(verifySkillSignature(body, signSkillBody(body, secret), secret).ok).toBe(true);
    expect(verifySkillSignature(body, "deadbeef", secret).ok).toBe(false);

    let skills = listLocalSkills(ws);
    expect(skills[0]?.signatureOk).toBe(true);
    expect(skills[0]?.enabled).toBe(true);

    fs.writeFileSync(path.join(dir, "SKILL.sig"), "tampered\n");
    skills = listLocalSkills(ws);
    expect(skills[0]?.signatureOk).toBe(false);
    expect(skills[0]?.enabled).toBe(false);

    // restore + disable via enabled.json
    fs.writeFileSync(path.join(dir, "SKILL.sig"), signSkillBody(body, secret));
    writeSkillEnabled(ws, "demo", false);
    skills = listLocalSkills(ws);
    expect(skills[0]?.enabled).toBe(false);
  });
});
