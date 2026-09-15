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
    expect(tools.map((t) => t.name)).toContain("compare_documents");
    expect(tools.map((t) => t.name)).toContain("run_compute");
    expect(tools.map((t) => t.name)).toContain("search_conversations");
    expect(tools.map((t) => t.name)).toContain("read_conversation");
    expect(tools.map((t) => t.name)).toContain("write_document");
    expect(tools.map((t) => t.name)).toContain("list_mail_inbox");
    expect(tools.map((t) => t.name)).toContain("search_matter");
    expect(tools.map((t) => t.name)).not.toContain("draft_document");
    expect(tools.map((t) => t.name)).not.toContain("calculate");
    expect(tools.map((t) => t.name)).not.toContain("search_case_law");
  });

  it("discloses execute_workflow for this session", async () => {
    const result = await listMoreTools.execute({ name: "execute_workflow" }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { disclosedName?: string }).disclosedName).toBe("execute_workflow");
  });

  it("does not re-disclose a core tool", async () => {
    const result = await listMoreTools.execute({ name: CORE_MODEL_TOOL_NAMES[0] }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { alreadyAvailable?: string[] }).alreadyAvailable).toEqual([
      CORE_MODEL_TOOL_NAMES[0],
    ]);
    expect((result.data as { disclosedName?: string }).disclosedName).toBeUndefined();
  });

  it("rejects unknown names", async () => {
    const result = await listMoreTools.execute({ name: "not_a_real_tool" }, ctx);
    expect(result.ok).toBe(false);
    expect(listMoreTools.definition.name).toBe(LIST_MORE_TOOLS_NAME);
  });

  it("hides web_search in the catalog until compose 联网 is on", async () => {
    const listed = await listMoreTools.execute({}, ctx);
    const names = (listed.data as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("search_statute_web");
    expect(names).not.toContain("url_dossier");

    const enable = await listMoreTools.execute({ name: "web_search" }, ctx);
    expect(enable.ok).toBe(false);
    expect(enable.error).toContain("联网");
    expect(enable.error).toContain("list_more_tools");
  });

  it("lists web_search when allowWebSearch is true", async () => {
    const listed = await listMoreTools.execute({}, { ...ctx, allowWebSearch: true });
    const names = (listed.data as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names).toContain("web_search");
    const enable = await listMoreTools.execute(
      { name: "web_search" },
      { ...ctx, allowWebSearch: true },
    );
    expect(enable.ok).toBe(true);
  });

  it("treats update_plan as already available", async () => {
    const result = await listMoreTools.execute({ name: "update_plan" }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { alreadyAvailable?: string[] }).alreadyAvailable).toEqual([
      "update_plan",
    ]);
  });

  it("discloses mcp tool names without putting them in the static catalog", async () => {
    const listed = await listMoreTools.execute({}, ctx);
    const names = (listed.data as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(false);
    const enable = await listMoreTools.execute({ name: "mcp__pkulaw__search" }, ctx);
    expect(enable.ok).toBe(true);
    expect((enable.data as { disclosedName?: string }).disclosedName).toBe("mcp__pkulaw__search");
  });

  it("enables several extra tools in one call", async () => {
    const result = await listMoreTools.execute({ names: ["write_document", "search_matter"] }, ctx);
    expect(result.ok).toBe(true);
    expect((result.data as { disclosedNames?: string[] }).disclosedNames).toEqual([
      "write_document",
      "search_matter",
    ]);
    const csv = await listMoreTools.execute({ name: "write_document, list_mail_inbox" }, ctx);
    expect(csv.ok).toBe(true);
    expect((csv.data as { disclosedNames?: string[] }).disclosedNames).toEqual([
      "write_document",
      "list_mail_inbox",
    ]);
  });
});
