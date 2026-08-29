import { describe, expect, it } from "vitest";
import { CORE_MODEL_TOOL_NAMES, LIST_MORE_TOOLS_NAME } from "../governance.js";
import { listMoreTools } from "./list-more-tools.js";

const ctx = {
  workspaceDir: "/tmp/lawmind-list-more",
  sessionId: "s1",
  actorId: "test",
};

describe("list_more_tools", () => {
  it("returns the disclosure catalog without a name", async () => {
    const result = await listMoreTools.execute({}, ctx);
    expect(result.ok).toBe(true);
    const tools = (result.data as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toContain("execute_workflow");
    expect(tools.map((t) => t.name)).toContain("draft_document");
    expect(tools.map((t) => t.name)).toContain("compare_documents");
  });

  it("discloses execute_workflow for this session", async () => {
    const result = await listMoreTools.execute({ name: "execute_workflow" }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { disclosedName?: string }).disclosedName).toBe("execute_workflow");
  });

  it("does not re-disclose a core tool", async () => {
    const result = await listMoreTools.execute({ name: CORE_MODEL_TOOL_NAMES[0] }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { alreadyAvailable?: boolean }).alreadyAvailable).toBe(true);
    expect((result.data as { disclosedName?: string }).disclosedName).toBeUndefined();
  });

  it("rejects unknown names", async () => {
    const result = await listMoreTools.execute({ name: "not_a_real_tool" }, ctx);
    expect(result.ok).toBe(false);
    expect(listMoreTools.definition.name).toBe(LIST_MORE_TOOLS_NAME);
  });
});
