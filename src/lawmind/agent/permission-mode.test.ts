import { describe, expect, it } from "vitest";
import {
  filterToolsForPermissionMode,
  parsePermissionMode,
  READONLY_AGENT_TOOL_NAMES,
  RESEARCH_AGENT_TOOL_NAMES,
} from "./permission-mode.js";

describe("permission-mode", () => {
  const all = [
    "search_matter",
    "research_task",
    "draft_document",
    "render_document",
    "execute_workflow",
    "analyze_document",
  ];

  it("parses research mode", () => {
    expect(parsePermissionMode("research")).toBe("research");
    expect(parsePermissionMode("nope")).toBe("standard");
  });

  it("readonly blocks research_task and draft", () => {
    const filtered = filterToolsForPermissionMode(all, "readonly");
    expect(filtered).toContain("analyze_document");
    expect(filtered).not.toContain("research_task");
    expect(filtered).not.toContain("draft_document");
    expect(READONLY_AGENT_TOOL_NAMES.has("research_task")).toBe(false);
  });

  it("research allows research_task but not draft/render/workflow", () => {
    const filtered = filterToolsForPermissionMode(all, "research");
    expect(filtered).toContain("research_task");
    expect(filtered).toContain("analyze_document");
    expect(filtered).not.toContain("draft_document");
    expect(filtered).not.toContain("render_document");
    expect(filtered).not.toContain("execute_workflow");
    expect(RESEARCH_AGENT_TOOL_NAMES.has("research_task")).toBe(true);
  });

  it("allows conversation search in readonly mode", () => {
    expect(
      filterToolsForPermissionMode(
        ["search_conversations", "read_conversation", "draft_document"],
        "readonly",
      ),
    ).toEqual(["search_conversations", "read_conversation"]);
  });

  it("readonly keeps update_plan as a control tool", () => {
    expect(filterToolsForPermissionMode(["update_plan", "draft_document"], "readonly")).toEqual([
      "update_plan",
    ]);
  });

  it("allows public web search tools in research and readonly modes", () => {
    const names = [
      "web_search",
      "search_statute_web",
      "url_dossier",
      "deep_research",
      "draft_document",
    ];
    const research = filterToolsForPermissionMode(names, "research");
    expect(research).toEqual(
      expect.arrayContaining(["web_search", "search_statute_web", "url_dossier", "deep_research"]),
    );
    expect(research).not.toContain("draft_document");
    const readonly = filterToolsForPermissionMode(names, "readonly");
    expect(readonly).toEqual(
      expect.arrayContaining(["web_search", "search_statute_web", "url_dossier"]),
    );
    expect(readonly).not.toContain("deep_research");
  });
});
