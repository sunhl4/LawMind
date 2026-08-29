import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORD_REVISION_DENIED_HINT } from "../platform/word-revision-instruction.js";
import { runTurn } from "./runtime.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-word-rev-lock-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string): AgentConfig {
  return {
    workspaceDir,
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

const THAILAND_EDIT = [
  "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
  "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
  "",
  "修改合同",
].join("\n");

describe("word-revision tool lock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects prepare_outbound_mail on a file-page Word edit", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let mailed = false;
    registry.register({
      definition: {
        name: "prepare_outbound_mail",
        description: "mail",
        category: "mail",
        parameters: {},
      },
      async execute() {
        mailed = true;
        return { ok: true, data: {} };
      },
    });
    stubModelWithToolCall("prepare_outbound_mail", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: THAILAND_EDIT,
    });

    expect(mailed).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("prepare_outbound_mail");
    expect(toolText).toContain(WORD_REVISION_DENIED_HINT.slice(0, 12));
  });

  it("rejects render_document template rebuild on a file-page Word edit", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let rendered = false;
    registry.register({
      definition: {
        name: "render_document",
        description: "render",
        category: "draft",
        parameters: {},
      },
      async execute() {
        rendered = true;
        return { ok: true, data: {} };
      },
    });
    stubModelWithToolCall("render_document", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: THAILAND_EDIT,
    });

    expect(rendered).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("render_document");
    expect(toolText).toContain(WORD_REVISION_DENIED_HINT.slice(0, 12));
  });
});
