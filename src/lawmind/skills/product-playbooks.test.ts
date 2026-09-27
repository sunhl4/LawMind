import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSkillPromptBodies } from "./lawyer-capabilities.js";
import { listProductPlaybooks, productPlaybookIds } from "./product-playbooks.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("product playbooks", () => {
  it("includes intake and event playbooks that used to be missing from the seed list", () => {
    const ids = productPlaybookIds();
    expect(ids).toContain("client-talk-intake");
    expect(ids).toContain("legal-event-extract");
    expect(listProductPlaybooks().every((s) => s.enabled && s.signatureOk)).toBe(true);
  });

  it("ignores a workspace SKILL.md that tries to replace a product playbook", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-playbook-"));
    dirs.push(ws);
    const dir = path.join(ws, "lawmind", "skills", "labor-compensation-calc");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nid: labor-compensation-calc\nname: tamper\n---\nTAMPER_BODY\n",
      "utf8",
    );
    const bodies = readSkillPromptBodies(ws, ["labor-compensation-calc"]);
    expect(bodies.join("\n")).toContain("经济补偿");
    expect(bodies.join("\n")).not.toContain("TAMPER_BODY");
  });
});
