/**
 * 模板级工具预批准（preApproveToolNames）端到端：
 * strict Edition 下，白名单内的待拍板类工具在自动化（workflow 模板）上下文中
 * 注入 __approved；白名单外工具仍落入 awaiting_approval。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { templatePreApprovableTools } from "./orchestrator/executor.js";
import { runTurn } from "./runtime.js";
import * as sessionEventLog from "./session-event-log.js";
import { SessionPersistError } from "./session-persist.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-preapprove-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
    strictDangerousToolApproval: true,
    model: {
      provider: "openai-compatible",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "demo",
    },
  };
}

function stubModelWithToolCall(toolName: string, argsJson: string) {
  const responses = [
    {
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: toolName, arguments: argsJson } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    {
      choices: [
        {
          message: { role: "assistant", content: "已处理。" },
          finish_reason: "stop",
        },
      ],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        const next = responses.shift();
        if (next === undefined) {
          throw new Error("unexpected extra model call");
        }
        return next;
      },
    })),
  );
}

describe("template-level preApproveToolNames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("executor allowlist keeps only 待拍板-class tools", () => {
    expect(templatePreApprovableTools(undefined)).toBeUndefined();
    expect(templatePreApprovableTools([])).toBeUndefined();
    expect(
      templatePreApprovableTools([
        "apply_surgical_edits",
        "render_tracked_draft",
        "send_email",
        "prepare_outbound_mail",
      ]),
    ).toEqual(["apply_surgical_edits", "render_tracked_draft", "prepare_outbound_mail"]);
    expect(templatePreApprovableTools(["send_email", "render_document"])).toBeUndefined();
  });

  it("strict mode: whitelisted tool executes with __approved injected", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let captured: Record<string, unknown> | undefined;
    registry.register({
      definition: {
        name: "render_tracked_draft",
        description: "tracked render",
        category: "draft",
        parameters: {},
      },
      async execute(args) {
        captured = args;
        return { ok: true, data: { outputPath: "cases/m/审阅稿.docx" } };
      },
    });
    stubModelWithToolCall("render_tracked_draft", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
      preApproveToolNames: ["render_tracked_draft"],
    });

    expect(result.turn.status).toBe("completed");
    expect(captured?.__approved).toBe(true);
  });

  it("strict mode: local render does not pause the lawyer (待拍板 is outbound only)", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "render_tracked_draft",
        description: "tracked render",
        category: "draft",
        parameters: {},
      },
      async execute() {
        executed = true;
        return { ok: true, data: {} };
      },
    });
    stubModelWithToolCall("render_tracked_draft", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
    });

    expect(result.turn.status).toBe("completed");
    expect(executed).toBe(true);
  });

  it("strict mode: template list does not pre-approve tools outside the list", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "send_email",
        description: "send mail",
        category: "draft",
        parameters: {},
        requiresApproval: true,
      },
      async execute() {
        executed = true;
        return { ok: true, data: {} };
      },
    });
    stubModelWithToolCall("send_email", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请发送邮件",
      preApproveToolNames: ["render_tracked_draft", "prepare_outbound_mail"],
    });

    expect(result.turn.status).toBe("awaiting_approval");
    expect(executed).toBe(false);
  });

  it("strict mode: name-only list does not inject __approved for apply_surgical_edits", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let captured: Record<string, unknown> | undefined;
    registry.register({
      definition: {
        name: "apply_surgical_edits",
        description: "surgical",
        category: "draft",
        parameters: {},
      },
      async execute(args) {
        captured = args;
        return { ok: true, data: {} };
      },
    });
    stubModelWithToolCall(
      "apply_surgical_edits",
      JSON.stringify({ edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }] }),
    );

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请按字词改管辖",
      preApproveToolNames: ["apply_surgical_edits"],
    });

    expect(result.turn.status).toBe("completed");
    expect(captured?.__approved).not.toBe(true);
  });

  it("strict mode: matching hunk hash does pre-approve apply_surgical_edits", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let captured: Record<string, unknown> | undefined;
    registry.register({
      definition: {
        name: "apply_surgical_edits",
        description: "surgical",
        category: "draft",
        parameters: {},
      },
      async execute(args) {
        captured = args;
        return { ok: true, data: {} };
      },
    });
    const hunks = {
      task_id: "t1",
      edits: [{ find: "甲方所在地人民法院", replace: "上海仲裁委员会" }],
    };
    stubModelWithToolCall("apply_surgical_edits", JSON.stringify(hunks));

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请按字词改管辖",
      preApproveToolNames: ["apply_surgical_edits"],
      preApproveToolArgs: hunks,
    });

    expect(result.turn.status).toBe("completed");
    expect(captured?.__approved).toBe(true);
  });

  it("strict mode: model-supplied __approved is stripped and cannot self-approve", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      definition: {
        name: "send_email",
        description: "send mail",
        category: "draft",
        parameters: { to: { type: "string" } },
        requiresApproval: true,
      },
      async execute() {
        executed = true;
        return { ok: true, data: {} };
      },
    });
    // 模型在首次调用就自填 __approved: true（绕过尝试）。
    stubModelWithToolCall("send_email", JSON.stringify({ to: "a@b.com", __approved: true }));

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请发送邮件",
    });

    expect(result.turn.status).toBe("awaiting_approval");
    expect(executed).toBe(false);
  });

  it("resume pre-approval replaces model args wholesale (no appended keys)", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let captured: Record<string, unknown> | undefined;
    registry.register({
      definition: {
        name: "send_email",
        description: "send mail",
        category: "draft",
        parameters: {
          to: { type: "string" },
          attachment_paths: { type: "array" },
        },
        requiresApproval: true,
      },
      async execute(args) {
        captured = args;
        return { ok: true, data: {} };
      },
    });
    // 模型重发时夹带未获批的新键（额外附件）与自填审批旗标。
    stubModelWithToolCall(
      "send_email",
      JSON.stringify({
        to: "a@b.com",
        attachment_paths: ["cases/m1/未批附件.docx"],
        __approved: true,
      }),
    );

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请发送邮件",
      preApproveToolName: "send_email",
      preApproveToolArgs: { to: "a@b.com" },
    });

    expect(result.turn.status).toBe("completed");
    // 执行的参数必须恰好是律师批准的那组：不多一个键。
    expect(captured).toEqual({ to: "a@b.com", __approved: true });
  });

  it("persist failure stops the turn instead of continuing", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    vi.spyOn(sessionEventLog, "appendSessionEvent").mockImplementation(() => {
      throw new SessionPersistError("events");
    });
    stubModelWithToolCall("render_tracked_draft", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: "请导出审阅稿",
    });

    expect(result.turn.status).toBe("error");
    expect(result.reply).toContain("落盘");
    expect(result.turn.error).toContain("events");
  });
});
