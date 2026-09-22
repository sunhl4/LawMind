/**
 * LawMind Agent Runtime — 自主推理循环
 *
 * 核心 loop：
 *   1. 收到用户指令
 *   2. 构建 system prompt（包含律师 profile、案件上下文、可用工具）
 *   3. 发送给 LLM，附带 function calling tools
 *   4. LLM 决定调用工具 → 执行工具 → 把结果返还给 LLM
 *   5. 重复 3-4 直到 LLM 给出最终回答
 *   6. 保存 session，记录审计
 *
 * 与 reference agent stack 的差异：
 *   - reference agent stack 基于 pi-agent-core / pi-coding-agent
 *   - LawMind 直接使用 OpenAI compatible API + 自建工具调度
 *   - 但设计理念相同：LLM 驱动的自主推理 + tool use
 *
 * SSE 解析与模型调用的唯一实现位于 runtime-model-call.ts；此处仅做 re-export，
 * 避免双份实现漂移（测试覆盖的即线上运行的）。
 */

export {
  aggregateStreamChunks,
  callModelWithRetry,
  parseSseChunks,
  type CallModelOptions,
} from "./runtime-model-call.js";
export { runTurn, type RunTurnEvent } from "./turn-orchestrator.js";

export { validateToolArguments } from "./runtime-tool-validation.js";
