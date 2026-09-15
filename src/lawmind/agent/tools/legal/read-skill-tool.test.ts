import { describe, expect, it } from "vitest";
import { readSkillTool } from "./read-skill-tool.js";

const ctx = {
  workspaceDir: "/tmp/lawmind-read-skill-missing",
  sessionId: "s1",
  actorId: "test",
};

describe("read_skill", () => {
  it("lists a catalog when skill_id is omitted", async () => {
    const result = await readSkillTool.execute({}, ctx);
    expect(result.ok).toBe(true);
    const catalog = (result.data as { catalog: string[] }).catalog;
    expect(catalog.some((row) => row.includes("contract.review"))).toBe(true);
  });

  it("loads a builtin skill body", async () => {
    const result = await readSkillTool.execute({ skill_id: "quick-legal-triage" }, ctx);
    expect(result.ok).toBe(true);
    expect(String((result.data as { body?: string }).body)).toContain("法律快问");
  });

  it("accepts a lawyer capability label without dumping a pipeline", async () => {
    const result = await readSkillTool.execute({ skill_id: "合同审查" }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { kind?: string }).kind).toBe("capability");
  });
});
