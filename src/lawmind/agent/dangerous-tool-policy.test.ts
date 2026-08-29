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

  it("only send_email pauses the lawyer; internal production runs through", () => {
    expect(
      toolRequiresExplicitApproval({
        toolName: "send_email",
        definition: { ...defApproved, name: "send_email" },
        allowDangerousToolsWithoutApproval: false,
        strictDangerousToolApproval: false,
      }),
    ).toBe(true);
    expect(
      toolRequiresExplicitApproval({
        toolName: "send_email",
        definition: { ...defApproved, name: "send_email" },
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: false,
      }),
    ).toBe(false);
    expect(
      toolRequiresExplicitApproval({
        toolName: "send_email",
        definition: { ...defApproved, name: "send_email" },
        allowDangerousToolsWithoutApproval: true,
        strictDangerousToolApproval: true,
      }),
    ).toBe(true);
    for (const toolName of [
      "write_document",
      "update_draft",
      "draft_document",
      "render_document",
      "prepare_outbound_mail",
      "execute_workflow",
      "add_case_note",
    ] as const) {
      expect(
        toolRequiresExplicitApproval({
          toolName,
          definition: { ...defApproved, name: toolName, requiresApproval: true },
          allowDangerousToolsWithoutApproval: false,
          strictDangerousToolApproval: true,
        }),
      ).toBe(false);
    }
  });
});
