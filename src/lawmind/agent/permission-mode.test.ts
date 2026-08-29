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
});
