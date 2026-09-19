import { describe, expect, it } from "vitest";
import type { AgentContext } from "../../types.js";
import { readSkillTool } from "./read-skill-tool.js";

function ctx(): AgentContext {
  return {
    workspaceDir: "/tmp/lawmind-read-skill",
    sessionId: "s1",
    actorId: "lawyer",
    projectDir: undefined,
    allowWebSearch: false,
    collaborationEnabled: false,
    clarificationBlockingHeavyTools: false,
    strictDangerousToolApproval: false,
  } as AgentContext;
}

describe("read_skill external index", () => {
  it("returns externalIndex metadata when skill_id is omitted", async () => {
    const r = await readSkillTool.execute({}, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as { catalog?: string[]; externalIndex?: string[]; message?: string };
    expect(Array.isArray(data.catalog)).toBe(true);
    expect(Array.isArray(data.externalIndex)).toBe(true);
    expect(data.externalIndex!.length).toBeGreaterThan(0);
    expect(data.externalIndex![0]).toContain("规范库");
    expect(data.message).toMatch(/不装包/);
  });

  it("returns canonical_index without a body for design-corpus ids", async () => {
    const r = await readSkillTool.execute({ skill_id: "legal-research-cn" }, ctx());
    expect(r.ok).toBe(true);
    const data = r.data as {
      kind?: string;
      body?: string;
      sourceRepo?: string;
      message?: string;
    };
    expect(data.kind).toBe("canonical_index");
    expect(data.body).toBeUndefined();
    expect(data.sourceRepo).toContain("Golden2002");
    expect(data.message).toMatch(/仅元数据/);
  });
});
