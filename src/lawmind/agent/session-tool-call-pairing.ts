/**
 * tool_call ↔ tool 消息配对守卫。
 *
 * OpenAI 兼容 API 要求：带 tool_calls 的 assistant 消息之后，每个 tool_call
 * 都必须有配对的 tool 消息（按 tool_call_id），否则整个请求 400，会话损坏。
 * 生产侧由 executeToolBatches 兜底补齐（审批/澄清中断时同批剩余调用写「已跳过」）；
 * 本模块提供送出前的最后一道：
 *   - findUnpairedToolCallIds：观测/断言用（session-history-alignment、测试）。
 *   - repairToolCallPairing：强制修复，为悬空 tool_call 补「已取消」占位 tool 消息。
 */

import type { AgentMessage, ToolCall } from "./types.js";

/** 占位 tool 消息的错误文案：明确告知模型该调用未执行，避免被当作成功结果续写。 */
export const TOOL_CALL_PAIRING_PLACEHOLDER_ERROR =
  "已取消：该调用未执行（前序操作中断或待律师处理）";

/** 收集紧跟其后的 tool 消息已应答的 toolCallId。 */
function collectAnsweredIds(messages: AgentMessage[], assistantIndex: number): Set<string> {
  const answered = new Set<string>();
  for (let j = assistantIndex + 1; j < messages.length && messages[j]?.role === "tool"; j++) {
    for (const resp of messages[j]?.toolCallResponses ?? []) {
      answered.add(resp.toolCallId);
    }
  }
  return answered;
}

/** 列出所有没有配对 tool 消息的 tool_call id（按消息顺序）。 */
export function findUnpairedToolCallIds(messages: AgentMessage[]): string[] {
  const unpaired: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg?.role !== "assistant" || !msg.toolCalls?.length) {
      continue;
    }
    const answered = collectAnsweredIds(messages, i);
    for (const tc of msg.toolCalls) {
      if (!answered.has(tc.id)) {
        unpaired.push(tc.id);
      }
    }
  }
  return unpaired;
}

function placeholderToolMessage(tc: ToolCall): AgentMessage {
  const result = { ok: false as const, error: TOOL_CALL_PAIRING_PLACEHOLDER_ERROR };
  return {
    role: "tool",
    content: JSON.stringify(result),
    toolCallResponses: [{ toolCallId: tc.id, name: tc.name, result }],
    timestamp: new Date().toISOString(),
  };
}

/**
 * 返回补齐配对后的新消息序列（原数组不被修改）：每个悬空 tool_call 在其
 * assistant 消息已有的 tool 响应之后插入占位 tool 消息，保持原有相对顺序。
 */
export function repairToolCallPairing(messages: AgentMessage[]): {
  messages: AgentMessage[];
  repairedToolCallIds: string[];
} {
  const out: AgentMessage[] = [];
  const repairedToolCallIds: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    out.push(msg);
    if (msg?.role !== "assistant" || !msg.toolCalls?.length) {
      continue;
    }
    const answered = new Set<string>();
    while (i + 1 < messages.length && messages[i + 1]?.role === "tool") {
      i++;
      const toolMsg = messages[i];
      out.push(toolMsg);
      for (const resp of toolMsg?.toolCallResponses ?? []) {
        answered.add(resp.toolCallId);
      }
    }
    for (const tc of msg.toolCalls) {
      if (!answered.has(tc.id)) {
        repairedToolCallIds.push(tc.id);
        out.push(placeholderToolMessage(tc));
      }
    }
  }
  return { messages: out, repairedToolCallIds };
}
