import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeToolSandboxStatus,
  resolveToolSandboxEnabled,
  toolRequiresExplicitApproval,
  toolRequiresSubprocessSandbox,
} from "./dangerous-tool-policy.js";
import type { ToolDefinition } from "./types.js";

const defApproved: ToolDefinition = {
  name: "write_document",
  description: "w",
  category: "draft",
  parameters: {},
  requiresApproval: true,
};

describe("dangerous-tool-policy", () => {
  it("toolRequiresSubprocessSandbox matches high-risk tool set", () => {
    expect(toolRequiresSubprocessSandbox("render_document")).toBe(true);
    expect(toolRequiresSubprocessSandbox("read_project_file")).toBe(false);
    expect(toolRequiresSubprocessSandbox("analyze_document")).toBe(false);
    expect(toolRequiresSubprocessSandbox("research_task")).toBe(false);
  });

  it("describeToolSandboxStatus is off by default", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-pol-"));
    expect(describeToolSandboxStatus(ws).enabled).toBe(false);
    expect(describeToolSandboxStatus(ws).source).toBe("off");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("resolveToolSandboxEnabled reads policy toolSandbox", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-pol-"));
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, toolSandbox: true }),
      "utf8",
    );
    expect(resolveToolSandboxEnabled(ws)).toBe(true);
    expect(describeToolSandboxStatus(ws).source).toBe("policy");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("non-strict: requiresApproval respects allowDangerous bypass", () => {
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: false,
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
  });

  it("strict: requiresApproval always needs explicit approval even when allowDangerous is true", () => {
    expect(
      toolRequiresExplicitApproval({
        toolName: "write_document",
        definition: defApproved,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: true,
      }),
    ).toBe(true);
  });

  it("mid-work draft tools do not require approval by default (non-strict)", () => {
    for (const toolName of ["write_document", "update_draft"] as const) {
      const definition: ToolDefinition = {
        ...defApproved,
        name: toolName,
        requiresApproval: false,
      };
      expect(
        toolRequiresExplicitApproval({
          toolName,
          definition,
          allowDangerousToolsWithoutApproval: false,
          strictDangerousToolApproval: false,
        }),
      ).toBe(false);
    }
  });

  it("strict: governance-classified write tools require approval even without definition flag", () => {
    // In strict mode, WRITE_TOOLS membership enforces approval — aligning
    // runtime enforcement with governance metadata (which marks these
    // requiresApproval: true via resolveRuntimeMode).
    for (const toolName of [
      "write_document",
      "update_draft",
      "add_case_note",
      "apply_surgical_edits",
      "render_tracked_draft",
      "prepare_outbound_mail",
    ] as const) {
      const definition: ToolDefinition = {
        ...defApproved,
        name: toolName,
        requiresApproval: false,
      };
      expect(
        toolRequiresExplicitApproval({
          toolName,
          definition,
          allowDangerousToolsWithoutApproval: true,
          strictDangerousToolApproval: true,
        }),
      ).toBe(true);
    }
  });

  it("non-strict: read tools never require approval", () => {
    const definition: ToolDefinition = {
      ...defApproved,
      name: "search_statute",
      requiresApproval: false,
    };
    expect(
      toolRequiresExplicitApproval({
        toolName: "search_statute",
        definition,
        allowDangerousToolsWithoutApproval: false,
        strictDangerousToolApproval: true,
      }),
    ).toBe(false);
  });

  it("strict: execute_workflow needs explicit approval without requiresApproval on definition", () => {
    const defExec: ToolDefinition = {
      name: "execute_workflow",
      description: "x",
      category: "draft",
      parameters: { instruction: { type: "string", description: "i", required: true } },
    };
    expect(
      toolRequiresExplicitApproval({
        toolName: "execute_workflow",
        definition: defExec,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: true,
      }),
    ).toBe(true);
    expect(
      toolRequiresExplicitApproval({
        toolName: "execute_workflow",
        definition: defExec,
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
  });
});
