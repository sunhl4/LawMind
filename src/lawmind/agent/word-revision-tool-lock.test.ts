import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WORD_REVISION_DENIED_HINT } from "../platform/word-revision-instruction.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-word-rev-lock-"));
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

const THAILAND_EDIT = [
  "【用户在 LawMind 文件页将下列路径标为“本回合重点”（路径引用，需助手读取）】",
  "- [项目 · 路径引用] `泰国医疗人工智能战略合作框架协.docx`",
  "",
  "修改合同",
].join("\n");

describe("word-revision tool lock", () => {
  const servers: CassetteModelServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("rejects prepare_outbound_mail on a file-page Word edit", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
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
    stubModelWithToolCall(server, "prepare_outbound_mail");

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
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

  it("allows search_statute on a file-page Word edit", async () => {
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
      instruction: THAILAND_EDIT,
    });

    expect(searched).toBe(true);
    expect(result.turn.status).not.toBe("error");
  });
});
