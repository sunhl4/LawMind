import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIL_CONTRACT_FAST_PATH_DENIED_HINT } from "./mail-contract-fast-path.js";
import { runTurn } from "./runtime.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mail-lock-"));
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

const MAIL_SHORT = [
  "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
  "默认 contract_edit_baseline_path=`cases/m/a.docx`",
  "建议回复收件人：opp@firm.cn",
].join("\n");

describe("mail-contract short-path tool lock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows search_statute on a short-path turn", async () => {
    const workspaceDir = tmpWorkspace();
    const registry = new ToolRegistry();
    let searched = false;
    registry.register({
      definition: {
        name: "search_statute",
        description: "statute",
        category: "search",
        parameters: {},
      },
      async execute() {
        searched = true;
        return { ok: true, data: { hits: [] } };
      },
    });
    stubModelWithToolCall("search_statute", "{}");

    const result = await runTurn({
      config: baseConfig(workspaceDir),
      registry,
      instruction: MAIL_SHORT,
    });

    expect(searched).toBe(true);
    expect(result.turn.status).not.toBe("error");
  });

  it("rejects render_document on a short-path turn", async () => {
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
      instruction: MAIL_SHORT,
    });

    expect(rendered).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("render_document");
    expect(toolText).toContain(MAIL_CONTRACT_FAST_PATH_DENIED_HINT.slice(0, 12));
  });
});
