import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listLocalSkills,
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
