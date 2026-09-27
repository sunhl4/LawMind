/**
 * 权限模式执行层化端到端：
 * - readonly 轮里模型绕过广告清单直接点名写工具 → 管线硬拦（不依赖 prompt 过滤）。
 * - prompt「可用工具」目录与发给模型的 tools 均由本轮生效工具集生成（单一真相源）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runTurn } from "./runtime.js";
import { loadSession } from "./session.js";
import {
  cassetteAssistant,
  cassetteToolCall,
  startCassetteModelServer,
  type CassetteModelServer,
} from "./testkit/index.js";
import { ToolRegistry } from "./tools/registry.js";
import type { AgentConfig } from "./types.js";

function tmpWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-perm-gate-"));
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

function buildRegistry(onWrite: () => void): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    definition: {
      name: "analyze_document",
      description: "read",
      category: "analyze",
      parameters: {},
    },
    async execute() {
      return { ok: true, data: "read" };
    },
  });
  registry.register({
    definition: {
      name: "write_document",
      description: "write",
      category: "draft",
      parameters: {},
    },
    async execute() {
      onWrite();
      return { ok: true, data: { file_path: "x.md" } };
    },
  });
  registry.register({
    definition: {
      name: "list_more_tools",
      description: "more",
      category: "system",
      parameters: {},
    },
    async execute() {
      return { ok: true, data: {} };
    },
  });
  return registry;
}

/**
 * Loopback cassette：第一轮点名写工具，第二轮收尾；同时记录每次请求的 tools 广告清单。
 * （出口代理绕过 global fetch，模型字节走 127.0.0.1 本机服务。）
 */
function stubModelAdversarialWrite(
  server: CassetteModelServer,
  advertisedToolNames: string[][],
): void {
  server.onRequest((req) => {
    advertisedToolNames.push(req.advertisedToolNames());
  });
  server.enqueue(cassetteToolCall("write_document"), cassetteAssistant("已处理。"));
}

describe("permission mode execution-layer gate (e2e)", () => {
  const servers: CassetteModelServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
    vi.restoreAllMocks();
  });

  it("readonly: model write call bypassing the ad list is hard-blocked by the pipeline", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(server, advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "readonly",
    });

    // 写工具从未执行；错误话术引导模型改用只读工具或请律师切换模式。
    expect(writeExecuted).toBe(false);
    expect(result.turn.status).toBe("completed");
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("只读");
    expect(toolText).toContain("write_document");
    // 阻断决定落账：dangerous_tool_gate / block / safety_hard。
    expect(
      result.turn.gateDecisions?.some(
        (g) =>
          g.gate === "dangerous_tool_gate" &&
          g.decision === "block" &&
          g.category === "safety_hard",
      ),
    ).toBe(true);

    // 一致性：发给模型的 tools 广告清单本身也不含写工具（prompt 层过滤仍保留）。
    expect(advertised.length).toBeGreaterThan(0);
    for (const names of advertised) {
      expect(names).not.toContain("write_document");
      expect(names).toContain("analyze_document");
    }

    // 单一真相源：system prompt 的「可用工具」目录 = 本轮生效工具集。
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = session?.conversationHistory[0]?.content ?? "";
    expect(systemPrompt).toContain("**analyze_document**");
    expect(systemPrompt).not.toContain("**write_document**");
    const promptToolNames = new Set(
      [...systemPrompt.matchAll(/\*\*([a-z_][a-z0-9_]*)\*\* \[/g)].map((m) => m[1]),
    );
    for (const names of advertised) {
      expect(new Set(names)).toEqual(promptToolNames);
    }
  });

  it("standard: the same write call executes (permission gate does not over-block)", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(server, advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "standard",
    });

    expect(writeExecuted).toBe(true);
    expect(result.turn.status).toBe("completed");
    expect(result.turn.gateDecisions?.some((g) => g.gate === "dangerous_tool_gate")).toBe(false);
    // 标准模式：write_document 已注册即可点名执行，但不在常用 12 工具广告里。
    expect(advertised[0]).not.toContain("write_document");
    expect(advertised[0]).toContain("analyze_document");
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = session?.conversationHistory[0]?.content ?? "";
    expect(systemPrompt).toContain("**analyze_document**");
    expect(systemPrompt).not.toContain("**write_document**");
  });

  it("research: write tools blocked, research_task stays in the advertised set", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    registry.register({
      definition: {
        name: "research_task",
        description: "research",
        category: "research",
        parameters: {},
      },
      async execute() {
        return { ok: true, data: {} };
      },
    });
    const advertised: string[][] = [];
    stubModelAdversarialWrite(server, advertised);

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "research",
    });

    expect(writeExecuted).toBe(false);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("研究");
    expect(advertised[0]).toContain("research_task");
    expect(advertised[0]).not.toContain("write_document");
    const session = loadSession(workspaceDir, result.sessionId);
    const systemPrompt = session?.conversationHistory[0]?.content ?? "";
    expect(systemPrompt).toContain("**research_task**");
    expect(systemPrompt).not.toContain("**write_document**");
  });

  it("mid-session switch to readonly: tool catalog follows the turn, pipeline still hard-blocks", async () => {
    // 身份前缀按会话冻结；工具清单在缓存边界之后，本轮广告集可以改写。
    // 当轮权限由动态 world-state 块告知，写工具由 permissionModeMiddleware 硬拦。
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
    let writeExecuted = false;
    const registry = buildRegistry(() => {
      writeExecuted = true;
    });
    server.enqueue(
      // turn 1（standard）：直接收尾。
      cassetteAssistant("好的。"),
      // turn 2（readonly）：模型点名写工具。
      cassetteToolCall("write_document"),
      cassetteAssistant("已处理。"),
    );

    const first = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: "请导出审阅稿",
      permissionMode: "standard",
    });
    const second = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      sessionId: first.sessionId,
      instruction: "请导出审阅稿",
      permissionMode: "readonly",
    });

    expect(writeExecuted).toBe(false);
    const toolText = second.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).toContain("只读");
    // 工具清单在边界之后，随本轮广告集更新；常用集本身不含 write_document。权限块已是 readonly。
    const session = loadSession(workspaceDir, first.sessionId);
    const systemPrompt = session?.conversationHistory[0]?.content ?? "";
    expect(systemPrompt).toContain("**analyze_document**");
    expect(systemPrompt).not.toContain("**write_document**");
    expect(systemPrompt).toContain("<permission_mode>readonly</permission_mode>");
  });
});
