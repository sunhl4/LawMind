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

  it("resolveToolSandboxEnabled is driven by LAWMIND_TOOL_SANDBOX=1 (env)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-pol-"));
    const prev = process.env.LAWMIND_TOOL_SANDBOX;
    process.env.LAWMIND_TOOL_SANDBOX = "1";
    try {
      expect(resolveToolSandboxEnabled(ws)).toBe(true);
      expect(describeToolSandboxStatus(ws).source).toBe("env");
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_TOOL_SANDBOX;
      } else {
        process.env.LAWMIND_TOOL_SANDBOX = prev;
      }
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("policy key toolSandbox is rejected by the commercial policy contract (不再生效)", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sbx-pol-"));
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, toolSandbox: true }),
      "utf8",
    );
    // 策略合同只留 IT 硬边界：toolSandbox 被拒绝并说明原因，不再打开沙箱。
    expect(resolveToolSandboxEnabled(ws)).toBe(false);
    expect(describeToolSandboxStatus(ws).source).toBe("off");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("no tool pauses the lawyer mid-turn; outbound mail queues to 待发信 instead", () => {
    // 2026-10-01 起 send_email  disposition 从 pause 改为 inbox_signoff：
    // 任何 flag 组合下都不再产生回合中审批暂停；外发写入待发清单，律师在
    // 待发列表点「批准发送」才真正发出。
    for (const strict of [false, true]) {
      for (const allowBypass of [false, true]) {
        expect(
          toolRequiresExplicitApproval({
            toolName: "send_email",
            definition: { ...defApproved, name: "send_email" },
            allowDangerousToolsWithoutApproval: allowBypass,
            strictDangerousToolApproval: strict,
          }),
        ).toBe(false);
      }
    }
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
