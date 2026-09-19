/**
 * tool_call ↔ tool 消息配对守卫。
 *
 * OpenAI 兼容 API（DeepSeek 同样严格）要求两条不变量，缺一即整请求 400：
 *   1. 带 tool_calls 的 assistant 之后，每个 tool_call 都有紧随的 tool 消息。
 *   2. 每条 tool 消息都必须紧跟在那条 assistant（或同组的另一条 tool）之后，
 *      且 tool_call_id 对得上。压缩把 assistant 裁掉、留下结果，就是第 2 条。
 *
 * 生产侧由 executeToolBatches 兜底补齐（审批/澄清中断时同批剩余调用写「已跳过」）。
 * 送出前最后一道：
 *   - normalizeToolResultMessages：结果还对得上调用就挪回调用后面；对不上就丢掉。
 *   - repairToolCallPairing：仍缺结果的调用补「已取消」占位。
 *   - alignCutIndexToToolGroups / sliceKeepingToolGroups：压缩按整组切，不从工具结果中间下刀。
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

function primaryToolCallId(msg: AgentMessage): string | undefined {
  const id = msg.toolCallResponses?.[0]?.toolCallId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

/**
 * 列出找不到任何 tool_call 的 tool 结果 id（压缩把整条 assistant 丢掉后的残留）。
 * 与 {@link findUnpairedToolCallIds} 互为镜像，供审计观测；送出侧由
 * {@link normalizeToolResultMessages} 兜底修复。
 */
export function findOrphanToolResultIds(messages: AgentMessage[]): string[] {
  const knownIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    for (const tc of msg.toolCalls ?? []) {
      if (tc.id) {
        knownIds.add(tc.id);
      }
    }
  }
  const orphans: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") {
      continue;
    }
    const id = primaryToolCallId(msg);
    if (!id || !knownIds.has(id)) {
      orphans.push(id ?? "(missing)");
    }
  }
  return orphans;
}

/**
 * 一次裁切最多往回拉多少条，把 assistant 和它后面的 tool 结果留在同一组。
 * 再长就把这组从保留窗口里整组让出，避免一条超长工具批把压缩卡死。
 */
export const TOOL_GROUP_CUT_LOOKBACK = 16;

/**
 * 若 `cutIndex` 落在一组 tool 结果中间，退回到拥有这组的 assistant；
 * 找不到、或这组比 {@link TOOL_GROUP_CUT_LOOKBACK} 还长，则跳过剩余 tool，
 * 保证保留段不以孤立 tool 开头。
 */
export function alignCutIndexToToolGroups(
  messages: readonly AgentMessage[],
  cutIndex: number,
): number {
  if (cutIndex <= 0) {
    return 0;
  }
  if (cutIndex >= messages.length) {
    return messages.length;
  }
  if (messages[cutIndex]?.role !== "tool") {
    return cutIndex;
  }

  let owner = cutIndex;
  while (owner > 0 && messages[owner]?.role === "tool") {
    owner -= 1;
  }
  const ownerMsg = messages[owner];
  if (
    ownerMsg?.role === "assistant" &&
    (ownerMsg.toolCalls?.length ?? 0) > 0 &&
    cutIndex - owner <= TOOL_GROUP_CUT_LOOKBACK
  ) {
    return owner;
  }

  let skip = cutIndex;
  while (skip < messages.length && messages[skip]?.role === "tool") {
    skip += 1;
  }
  return skip;
}

/** 从尾部保留约 `keepCount` 条，但不会把一组 tool 调用切成两半。 */
export function sliceKeepingToolGroups(
  messages: AgentMessage[],
  keepCount: number,
): { kept: AgentMessage[]; dropped: AgentMessage[] } {
  if (keepCount >= messages.length) {
    return { kept: messages.slice(), dropped: [] };
  }
  if (keepCount <= 0) {
    return { kept: [], dropped: messages.slice() };
  }
  const cut = alignCutIndexToToolGroups(messages, messages.length - keepCount);
  return { kept: messages.slice(cut), dropped: messages.slice(0, cut) };
}

export type NormalizedToolResults = {
  messages: AgentMessage[];
  /** tool 消息被丢掉（调用已经不在历史里，或是重复结果）。 */
  droppedToolCallIds: string[];
  /** 结果还对得上某次调用，但没挨着它；已挪到该 assistant 的 tool 组末尾。 */
  relocatedToolCallIds: string[];
  changed: boolean;
};

/**
 * 让 tool 结果满足「紧跟对应 tool_calls」：
 * 对得上的孤立结果挪回去（律师仍能用到那次工具的真实回包）；
 * 对不上的丢掉（否则 DeepSeek / OpenAI 兼容接口直接 400，整段会话废掉）。
 * 不修改入参数组。
 */
export function normalizeToolResultMessages(messages: AgentMessage[]): NormalizedToolResults {
  const knownIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") {
      continue;
    }
    for (const tc of msg.toolCalls ?? []) {
      if (tc.id) {
        knownIds.add(tc.id);
      }
    }
  }

  const out: AgentMessage[] = [];
  const droppedToolCallIds: string[] = [];
  const pending = new Map<string, AgentMessage>();
  let open: Set<string> | null = null;

  for (const msg of messages) {
    if (msg.role === "tool") {
      const primary = primaryToolCallId(msg);
      if (open && primary && open.has(primary)) {
        open.delete(primary);
        out.push(msg);
        continue;
      }
      if (primary && knownIds.has(primary) && !pending.has(primary)) {
        pending.set(primary, msg);
        continue;
      }
      droppedToolCallIds.push(primary ?? "(missing)");
      continue;
    }
    open = null;
    out.push(msg);
    if (msg.role === "assistant" && (msg.toolCalls?.length ?? 0) > 0) {
      open = new Set(msg.toolCalls!.map((tc) => tc.id).filter((id) => id.length > 0));
    }
  }

  if (pending.size === 0 && droppedToolCallIds.length === 0) {
    return {
      messages,
      droppedToolCallIds,
      relocatedToolCallIds: [],
      changed: false,
    };
  }
  if (pending.size === 0) {
    return {
      messages: out,
      droppedToolCallIds,
      relocatedToolCallIds: [],
      changed: true,
    };
  }

  const final: AgentMessage[] = [];
  const relocatedToolCallIds: string[] = [];
  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    final.push(msg);
    if (msg.role !== "assistant" || !msg.toolCalls?.length) {
      continue;
    }
    const want = new Set(msg.toolCalls.map((tc) => tc.id));
    while (i + 1 < out.length && out[i + 1]?.role === "tool") {
      i += 1;
      const tool = out[i];
      final.push(tool);
      const id = primaryToolCallId(tool);
      if (id) {
        want.delete(id);
      }
    }
    for (const tc of msg.toolCalls) {
      if (!want.has(tc.id)) {
        continue;
      }
      const parked = pending.get(tc.id);
      if (!parked) {
        continue;
      }
      final.push(parked);
      pending.delete(tc.id);
      relocatedToolCallIds.push(tc.id);
    }
  }
  for (const id of pending.keys()) {
    droppedToolCallIds.push(id);
  }
  return {
    messages: final,
    droppedToolCallIds,
    relocatedToolCallIds,
    changed: true,
  };
}

/**
 * 历史尾部是否停在一组尚未答完的工具调用上（批次执行中）。
 * 落盘时遇到这种快照必须推迟：否则会持久化「assistant(tool_calls) 没有结果」
 * 或「结果没有调用」的半批历史（Claude Code #31328 的同类故障）。
 */
export function hasOpenToolGroup(messages: readonly AgentMessage[]): boolean {
  let last = messages.length - 1;
  while (last >= 0 && messages[last]?.role === "system") {
    last -= 1;
  }
  if (last < 0) {
    return false;
  }
  for (let i = last; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role === "tool") {
      continue;
    }
    if (msg.role !== "assistant" || !(msg.toolCalls?.length ?? 0)) {
      return false;
    }
    const answered = new Set<string>();
    for (let j = i + 1; j <= last; j += 1) {
      for (const resp of messages[j]?.toolCallResponses ?? []) {
        answered.add(resp.toolCallId);
      }
    }
    return msg.toolCalls!.some((tc) => !answered.has(tc.id));
  }
  return false;
}

/** wire 形状的 chat.completions 消息（与 session 内部 AgentMessage 分离）。 */
export type WireChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
};

export type SanitizedWireMessages<T extends WireChatMessage> = {
  messages: T[];
  /** 补了合成结果的 tool_call id（模型发起了调用但没有回包）。 */
  repairedToolCallIds: string[];
  /** 丢掉的孤立结果 id（调用已不在历史里）。 */
  droppedToolCallIds: string[];
  changed: boolean;
};

/**
 * wire 层最后一道（Codex `for_prompt` 的对应物）：任何调用方构造的消息，
 * 在送进 HTTP body 之前都先归一化。
 *
 * 与 {@link normalizeToolResultMessages} 的区别是作用对象——这里处理的是
 * chat.completions 的 `tool_call_id` / `tool_calls` 形状，因此
 * draft-worker、readonly-worker、压缩 digest、collaboration 等**不走
 * session 历史**的调用方同样受保护；那些路径没有 session 可修复。
 *
 * - 调用缺结果 → 补一条合成结果（否则 OpenAI 兼容接口 400）。
 * - 结果缺调用 → 丢掉（DeepSeek / OpenAI 兼容接口对孤立 tool 直接 400）。
 * - 结果与调用对得上但没挨着 → 挪回该 assistant 的工具组末尾。
 */
export function sanitizeWireMessages<T extends WireChatMessage>(
  messages: readonly T[],
): SanitizedWireMessages<T> {
  const knownIds = new Set<string>();
  const answeredIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "tool") {
      if (typeof msg.tool_call_id === "string" && msg.tool_call_id) {
        answeredIds.add(msg.tool_call_id);
      }
      continue;
    }
    if (msg.role !== "assistant") {
      continue;
    }
    for (const tc of msg.tool_calls ?? []) {
      if (tc.id) {
        knownIds.add(tc.id);
      }
    }
  }
  const needsSynthetic = [...knownIds].some((id) => !answeredIds.has(id));

  const repairedToolCallIds: string[] = [];
  const droppedToolCallIds: string[] = [];
  const out: T[] = [];
  const pending = new Map<string, T>();
  let open: Set<string> | null = null;

  const syntheticToolMessage = (id: string): T =>
    ({
      role: "tool",
      content: JSON.stringify({
        ok: false,
        error: TOOL_CALL_PAIRING_PLACEHOLDER_ERROR,
      }),
      tool_call_id: id,
    }) as T;

  for (const msg of messages) {
    if (msg.role === "tool") {
      const id = typeof msg.tool_call_id === "string" ? msg.tool_call_id : "";
      if (open && id && open.has(id)) {
        open.delete(id);
        out.push(msg);
        continue;
      }
      if (id && knownIds.has(id) && !pending.has(id)) {
        pending.set(id, msg);
        continue;
      }
      droppedToolCallIds.push(id || "(missing)");
      continue;
    }
    open = null;
    out.push(msg);
    if (msg.role === "assistant" && (msg.tool_calls?.length ?? 0) > 0) {
      open = new Set((msg.tool_calls ?? []).map((tc) => tc.id ?? "").filter((id) => id.length > 0));
    }
  }

  const changed = pending.size > 0 || droppedToolCallIds.length > 0 || needsSynthetic;
  if (!changed) {
    return { messages: [...messages], repairedToolCallIds, droppedToolCallIds, changed: false };
  }

  const final: T[] = [];
  for (let i = 0; i < out.length; i += 1) {
    const msg = out[i];
    final.push(msg);
    if (msg.role !== "assistant" || !(msg.tool_calls?.length ?? 0)) {
      continue;
    }
    const want = new Set((msg.tool_calls ?? []).map((tc) => tc.id ?? ""));
    while (i + 1 < out.length && out[i + 1]?.role === "tool") {
      i += 1;
      const tool = out[i];
      final.push(tool);
      const id = typeof tool.tool_call_id === "string" ? tool.tool_call_id : "";
      want.delete(id);
    }
    for (const id of want) {
      const parked = pending.get(id);
      if (parked) {
        final.push(parked);
        pending.delete(id);
        continue;
      }
      if (id) {
        final.push(syntheticToolMessage(id));
        repairedToolCallIds.push(id);
      }
    }
  }
  for (const id of pending.keys()) {
    droppedToolCallIds.push(id);
  }
  return { messages: final, repairedToolCallIds, droppedToolCallIds, changed: true };
}

/**
 * 服务端 400 是否属于「工具调用配对损坏」。
 * 覆盖 DeepSeek / OpenAI 兼容（截图那一条）与 Anthropic 文案，避免把
 * 参数错误之类的 400 误判成可自愈。
 */
export function isToolPairingRejectText(text: string): boolean {
  const t = text ?? "";
  if (!t) {
    return false;
  }
  if (
    /role ['"]?tool['"]? must be a response to a preceding message with ['"]?tool_calls/i.test(t)
  ) {
    return true;
  }
  if (/preceding message with ['"]?tool_calls/i.test(t)) {
    return true;
  }
  if (/unexpected [`'"]?tool_use_id/i.test(t) && /tool_result/i.test(t)) {
    return true;
  }
  if (/tool_result/i.test(t) && /must have a corresponding [`'"]?tool_use/i.test(t)) {
    return true;
  }
  return /no corresponding ['"]?tool_call/i.test(t) && /tool_call_id|tool_call\b/i.test(t);
}
