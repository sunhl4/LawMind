import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-contract-lock-"));
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

describe("contract fast-lane tool lock", () => {
  const servers: CassetteModelServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it("allows search_statute on a 5-minute review turn", async () => {
    const workspaceDir = tmpWorkspace();
    const server = await startCassetteModelServer();
    servers.push(server);
    const registry = new ToolRegistry();
    let searched = false;
    registry.register({
      definition: {
        name: "search_statute",
        description: "search",
        category: "search",
        parameters: {},
        riskLevel: "low",
      },
      async execute() {
        searched = true;
        return { ok: true, data: { hits: [] } };
      },
    });
    // Loopback cassette：出口代理绕过 global fetch，模型字节由本机服务脚本化。
    server.enqueue(cassetteToolCall("search_statute"), cassetteAssistant("已处理。"));

    const result = await runTurn({
      config: baseConfig(workspaceDir, server.url),
      registry,
      instruction: [
        "【交办】5 分钟合同审查",
        "交付物类型：合同审查意见",
        "- 合同/材料说明：nda.docx",
        "- 审查重点：付款与违约",
        "- 己方立场：委托方（保护我方利益）",
        "审查深度：快速。",
      ].join("\n"),
    });

    expect(searched).toBe(true);
    const toolText = result.turn.messages
      .flatMap((msg) => msg.toolCallResponses ?? [])
      .map((resp) => resp.result.error ?? "")
      .join("\n");
    expect(toolText).not.toContain("合同审查快车道");
  });
});
