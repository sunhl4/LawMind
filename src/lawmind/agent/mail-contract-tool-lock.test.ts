import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAIL_CONTRACT_FAST_PATH_DENIED_HINT } from "./mail-contract-fast-path.js";
import { runTurn } from "./runtime.js";
import {
  cassetteAssistant,
  cassetteToolCall,
  startCassetteModelServer,
  type CassetteModelServer,
} from "./testkit/index.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-mail-lock-"));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  fs.writeFileSync(path.join(dir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");
  return dir;
}

function baseConfig(workspaceDir: string, baseUrl: string): AgentConfig {
  return {
    workspaceDir,
    model: {
      provider: "openai-compatible",
      baseUrl,
      apiKey: "sk-test",
      model: "demo",
    },
  };
}

/** Loopback cassette：出口代理绕过 global fetch，模型字节由本机服务脚本化。 */
function stubModelWithToolCall(server: CassetteModelServer, toolName: string): void {
  server.enqueue(cassetteToolCall(toolName), cassetteAssistant("已处理。"));
}

const MAIL_SHORT = [
  "【邮件合同审阅改稿 · 短路径 · 原文件审阅痕迹】",
  "默认 contract_edit_baseline_path=`cases/m/a.docx`",
  "建议回复收件人：opp@firm.cn",
].join("\n");

describe("mail-contract short-path tool lock", () => {
  const servers: CassetteModelServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("allows search_statute on a short-path turn", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
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
    stubModelWithToolCall(server, "search_statute");

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: MAIL_SHORT,
    });

    expect(searched).toBe(true);
    expect(result.turn.status).not.toBe("error");
  });

  it("rejects render_document on a short-path turn", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
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
    stubModelWithToolCall(server, "render_document");

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
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
