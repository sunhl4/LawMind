import { describe, expect, it } from "vitest";
import { CORE_MODEL_TOOL_NAMES, LIST_MORE_TOOLS_NAME } from "../governance.js";
import { enableableToolCatalog, listMoreTools } from "./list-more-tools.js";

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
    expect(tools.map((t) => t.name)).toContain("get_matter_summary");
    expect(tools.map((t) => t.name)).toContain("read_case_file");
    expect(tools.map((t) => t.name)).toContain("list_matters");
    expect(tools.map((t) => t.name)).toContain("add_case_note");
    expect(tools.map((t) => t.name)).toContain("record_deadline");
    expect(tools.map((t) => t.name)).toContain("extract_legal_events");
    expect(tools.map((t) => t.name)).toContain("apply_legal_events");
    expect(tools.map((t) => t.name)).toContain("compile_intake_brief");
    expect(tools.map((t) => t.name)).toContain("apply_intake_brief");
    expect(tools.map((t) => t.name)).toContain("update_matter_profile");
    expect(tools.map((t) => t.name)).toContain("revert_desk_write");
    expect(tools.map((t) => t.name)).toContain("create_matter");
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

describe("enableableToolCatalog（提示词菜单与 list_more_tools 同源）", () => {
  it("排除核心工具，只留可按需启用的", () => {
    const names = enableableToolCatalog({ workspaceDir: ctx.workspaceDir }).map((r) => r.name);
    expect(names).toContain("execute_workflow");
    for (const core of CORE_MODEL_TOOL_NAMES) {
      expect(names, `${core} 是核心工具，不该出现在菜单里`).not.toContain(core);
    }
    expect(names).not.toContain(LIST_MORE_TOOLS_NAME);
  });

  it("与注册表求交：没注册的能力不进菜单（提示词不能说谎）", () => {
    const names = enableableToolCatalog({
      workspaceDir: ctx.workspaceDir,
      registeredNames: ["execute_workflow", "compare_documents"],
    }).map((r) => r.name);
    expect(names).toContain("execute_workflow");
    expect(names).toContain("compare_documents");
    expect(names).not.toContain("send_email");
  });

  it("联网关闭时不列联网能力；打开后才列", () => {
    const off = enableableToolCatalog({ workspaceDir: ctx.workspaceDir }).map((r) => r.name);
    expect(off).not.toContain("web_search");
    expect(off).not.toContain("search_statute_web");
    expect(off).not.toContain("url_dossier");
    const on = enableableToolCatalog({
      workspaceDir: ctx.workspaceDir,
      allowWebSearch: true,
    }).map((r) => r.name);
    expect(on).toContain("web_search");
    expect(on).toContain("search_statute_web");
  });

  it("每条都有名称与用途（菜单不能只有名字没有作用）", () => {
    for (const row of enableableToolCatalog({ workspaceDir: ctx.workspaceDir })) {
      expect(row.name.trim().length, JSON.stringify(row)).toBeGreaterThan(0);
      expect(row.hint.trim().length, JSON.stringify(row)).toBeGreaterThan(0);
    }
  });
});
