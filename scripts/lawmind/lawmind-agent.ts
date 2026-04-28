/**
 * LawMind Agent CLI — 交互式法律智能助理
 *
 * 用法：
 *   pnpm lawmind:agent                      — 新建对话
 *   pnpm lawmind:agent --session <id>       — 恢复已有对话
 *   pnpm lawmind:agent --matter <matterId>  — 关联案件
 *   pnpm lawmind:agent --list-sessions      — 列出历史对话
 *   pnpm lawmind:agent --message "..."      — 单次指令（非交互）
 */

import path from "node:path";
import readline from "node:readline";
import { createLawMindAgent } from "../../src/lawmind/agent/index.js";
import type { AgentConfig } from "../../src/lawmind/agent/types.js";
import { loadLawMindEnv } from "./lawmind-env-loader.js";

loadLawMindEnv();

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) {
    return undefined;
  }
  return args[idx + 1];
}

const hasFlag = (name: string) => args.includes(`--${name}`);

const workspaceDir = path.resolve(getArg("workspace") ?? "workspace");
const sessionId = getArg("session");
const matterId = getArg("matter");
const singleMessage = getArg("message");
const listSessionsMode = hasFlag("list-sessions");

// 从环境变量读取模型配置（与 .env.lawmind 中 LAWMIND_QWEN_* 一致，无需重复配置）
const defaultBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const modelTimeoutMs = parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS", 60000);
const toolTimeoutMs = parsePositiveIntEnv("LAWMIND_TOOL_TIMEOUT_MS", modelTimeoutMs);
const modelConfig = {
  provider: "openai-compatible" as const,
  baseUrl:
    process.env.LAWMIND_AGENT_BASE_URL ??
    process.env.QWEN_BASE_URL ??
    process.env.LAWMIND_QWEN_BASE_URL ??
    defaultBaseUrl,
  apiKey:
    process.env.LAWMIND_AGENT_API_KEY ??
    process.env.QWEN_API_KEY ??
    process.env.LAWMIND_QWEN_API_KEY ??
    "",
  model:
    process.env.LAWMIND_AGENT_MODEL ??
    process.env.QWEN_MODEL ??
    process.env.LAWMIND_QWEN_MODEL ??
    "qwen-plus",
  maxTokens: 4096,
  temperature: 0.3,
  timeoutMs: modelTimeoutMs,
};

if (!modelConfig.apiKey) {
  console.error("未设置模型 API Key。请在 .env.lawmind 中配置：");
  console.error("  LAWMIND_QWEN_API_KEY=your-api-key   （与 smoke/demo 共用）");
  console.error("  或 LAWMIND_AGENT_API_KEY / QWEN_API_KEY");
  console.error("  LAWMIND_QWEN_MODEL=qwen-max   （可选，默认 qwen-plus）");
  process.exit(1);
}

// 启动时打印实际使用的模型与 baseUrl，便于排查 404（请确认在仓库根或 ~/.lawmind/checkout 下运行）
console.error(
  `[LawMind Agent] model=${modelConfig.model} baseUrl=${modelConfig.baseUrl.replace(/\/$/, "")} cwd=${process.cwd()}`,
);

const config: AgentConfig = {
  workspaceDir,
  model: modelConfig,
  maxToolCalls: 15,
  maxHistoryMessages: 50,
  toolExecutionTimeoutMs: toolTimeoutMs,
  actorId: "lawyer",
};

const agent = createLawMindAgent(config);

async function main() {
  if (listSessionsMode) {
    const sessions = agent.listSessions();
    if (sessions.length === 0) {
      console.log("暂无历史对话。");
      return;
    }
    console.log(`\n  共 ${sessions.length} 个对话：\n`);
    for (const session of sessions) {
      const turnCount = session.turns.length;
      const matterLabel = session.matterId ? ` [案件: ${session.matterId}]` : "";
      console.log(`  ${session.sessionId}${matterLabel}`);
      console.log(`    创建: ${session.createdAt}  更新: ${session.updatedAt}  轮次: ${turnCount}`);
      if (turnCount > 0) {
        const lastTurn = session.turns[turnCount - 1];
        console.log(`    最近指令: ${lastTurn.instruction.slice(0, 80)}`);
      }
      console.log();
    }
    return;
  }

  // 单次指令模式
  if (singleMessage) {
    console.log(`\n  ⚡ LawMind Agent — 单次指令模式\n`);
    console.log(`  指令: ${singleMessage}`);
    if (matterId) {
      console.log(`  案件: ${matterId}`);
    }
    console.log(`  模型: ${modelConfig.model}\n`);
    console.log("  思考中...\n");

    const result = await agent.chat(singleMessage, { sessionId, matterId });

    console.log(`  ── 回答 ──\n`);
    console.log(result.reply);
    console.log(`\n  ── 元信息 ──`);
    console.log(`  会话 ID: ${result.sessionId}`);
    console.log(`  工具调用: ${result.turn.toolCallsExecuted} 次`);
    console.log(`  状态: ${result.turn.status}`);
    return;
  }

  // 交互模式
  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║          LawMind 法律智能助理           ║`);
  console.log(`  ╚════════════════════════════════════════╝\n`);

  if (sessionId) {
    const existing = agent.getSession(sessionId);
    if (existing) {
      console.log(`  恢复对话: ${sessionId}`);
      console.log(`  历史轮次: ${existing.turns.length}`);
    } else {
      console.log(`  会话 ${sessionId} 不存在，将创建新对话。`);
    }
  }
  if (matterId) {
    console.log(`  关联案件: ${matterId}`);
  }
  console.log(`  模型: ${modelConfig.model}`);
  console.log(`  输入 /quit 退出，/tools 查看可用工具，/session 查看当前对话信息\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentSessionId = sessionId;

  const prompt = () => {
    rl.question("  律师 > ", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log("\n  再见。\n");
        rl.close();
        return;
      }

      if (trimmed === "/tools") {
        const tools = agent.listTools();
        console.log(`\n  可用工具 (${tools.length}):\n`);
        for (const tool of tools) {
          const approval = tool.requiresApproval ? " ⚠️" : "";
          console.log(`  [${tool.category}] ${tool.name}${approval}`);
          console.log(`    ${tool.description}\n`);
        }
        prompt();
        return;
      }

      if (trimmed === "/session") {
        if (!currentSessionId) {
          console.log("\n  尚未开始对话。\n");
        } else {
          const session = agent.getSession(currentSessionId);
          if (session) {
            console.log(`\n  会话 ID: ${session.sessionId}`);
            console.log(`  案件: ${session.matterId ?? "无"}`);
            console.log(`  轮次: ${session.turns.length}`);
            console.log(`  消息数: ${session.conversationHistory.length}`);
            console.log(`  创建: ${session.createdAt}`);
            console.log(`  更新: ${session.updatedAt}\n`);
          }
        }
        prompt();
        return;
      }

      try {
        console.log("\n  思考中...\n");
        const result = await agent.chat(trimmed, {
          sessionId: currentSessionId,
          matterId,
        });

        currentSessionId = result.sessionId;
        console.log(`  ── LawMind ──\n`);
        console.log(`  ${result.reply.split("\n").join("\n  ")}`);
        console.log(
          `\n  [工具调用: ${result.turn.toolCallsExecuted} | 状态: ${result.turn.status}]\n`,
        );
      } catch (err) {
        console.error(`\n  错误: ${err instanceof Error ? err.message : String(err)}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
