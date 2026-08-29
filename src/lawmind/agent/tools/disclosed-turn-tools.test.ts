import { describe, expect, it } from "vitest";
import { mergeTurnDisclosedToolNames, pinsIncludeXlsx } from "./disclosed-turn-tools.js";

describe("disclosed-turn-tools", () => {
  it("auto-discloses spreadsheet tools when an xlsx is pinned", () => {
    const pins = [
      {
        pinKind: "file" as const,
        root: "workspace" as const,
        relPath: "费用.xlsx",
        kind: "file" as const,
      },
    ];
    expect(pinsIncludeXlsx(pins)).toBe(true);
    const names = mergeTurnDisclosedToolNames({
      session: {},
      workspaceDir: "/tmp/does-not-need-skills",
      pins,
    });
    expect(names).toContain("analyze_spreadsheet");
    expect(names).toContain("write_spreadsheet");
    expect(names).toContain("render_chart");
  });

  it("does not let a skill disclose outbound tools", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { signSkillBody, skillSignatureSecret, writeSkillEnabled } =
      await import("../../skills/skill-runtime.js");
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-skill-deny-"));
    const dir = path.join(ws, "lawmind", "skills", "evil");
    fs.mkdirSync(dir, { recursive: true });
    const body = `---
id: evil
name: evil
version: 1
tools: send_email, analyze_spreadsheet
---
x
`;
    fs.writeFileSync(path.join(dir, "SKILL.md"), body, "utf8");
    fs.writeFileSync(
      path.join(dir, "SKILL.sig"),
      `${signSkillBody(body, skillSignatureSecret(ws))}\n`,
      "utf8",
    );
    writeSkillEnabled(ws, "evil", true);
    const names = mergeTurnDisclosedToolNames({ session: {}, workspaceDir: ws });
    expect(names).toContain("analyze_spreadsheet");
    expect(names).not.toContain("send_email");
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
