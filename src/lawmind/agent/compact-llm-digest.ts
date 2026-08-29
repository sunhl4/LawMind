/**
 * Optional LLM re-summarization of extractive compact digests (manual compact path).
 * Turn-time auto-compact stays extractive-only for latency.
 */

import { resolveCapabilityEnvelope } from "../models/capability-envelope.js";
import { buildDroppedSpanDigest, resolveCompactDigestCharCap } from "./compact.js";
import { callModelWithRetry } from "./runtime-model-call.js";
import type { AgentMessage, AgentModelConfig } from "./types.js";

export function isCompactLlmDigestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LAWMIND_COMPACT_LLM?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") {
    return false;
  }
  return true;
}

function dialogueSnippet(dropped: AgentMessage[], maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const msg of dropped) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const text = (msg.content ?? "").trim().replace(/\s+/g, " ");
    if (!text) {
      continue;
    }
    const line = `${msg.role === "user" ? "律师" : "助手"}：${text.slice(0, 500)}`;
    if (used + line.length > maxChars) {
      break;
    }
    parts.push(line);
    used += line.length + 1;
  }
  return parts.join("\n");
}

/**
 * Enhance extractive digest with a short model summary. On any failure, returns extractive.
 */
export async function enhanceCompactDigestWithLlm(opts: {
  model: AgentModelConfig;
  extractiveDigest: string;
  dropped: AgentMessage[];
  contextTokens?: number;
}): Promise<{ digest: string; usedLlm: boolean }> {
  const extractive = opts.extractiveDigest.trim();
  if (!extractive || !isCompactLlmDigestEnabled()) {
    return { digest: extractive, usedLlm: false };
  }

  const cap = resolveCompactDigestCharCap(opts.contextTokens);
  const envelope = resolveCapabilityEnvelope({
    contextTokens: opts.contextTokens ?? opts.model.contextTokens,
    taskKind: "classify",
    maxTokensOverride: 1_200,
    timeoutMs: Math.min(45_000, opts.model.timeoutMs ?? 60_000),
  });

  const snippet = dialogueSnippet(opts.dropped, Math.min(8_000, Math.floor(cap * 0.6)));
  const userContent = [
    "请将下列法律助理对话摘录压缩为连贯中文摘要（不超过 800 字）。",
    "保留：律师意图、关键当事人/标的、已做工具动作、待办与风险。",
    "不要编造未出现的事实；不要输出 JSON。",
    "",
    "【提取式要点】",
    extractive.slice(0, Math.min(6_000, cap)),
    "",
    "【对话摘录】",
    snippet || "（无正文摘录）",
  ].join("\n");

  try {
    const response = await callModelWithRetry(
      {
        ...opts.model,
        maxTokens: Math.min(1_200, envelope.maxOutputTokens),
        timeoutMs: envelope.modelTimeoutMs,
        temperature: 0.2,
        maxRetries: 0,
      },
      [
        {
          role: "system",
          content: "你是 LawMind 上下文压缩助手。只输出摘要正文。",
        },
        { role: "user", content: userContent },
      ],
      [],
    );
    const rawContent = response.choices?.[0]?.message?.content;
    const summary = String(rawContent ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (summary.length < 40) {
      return { digest: extractive, usedLlm: false };
    }
    const header = `【压缩前对话蒸馏】摘要：\n${summary.slice(0, Math.min(2_400, Math.floor(cap * 0.45)))}`;
    const merged = `${header}\n\n---\n\n${extractive}`;
    const digest =
      merged.length > cap ? `${merged.slice(0, Math.max(0, cap - 20))}\n…[蒸馏截断]` : merged;
    return { digest, usedLlm: true };
  } catch {
    return { digest: extractive || buildDroppedSpanDigest(opts.dropped, cap), usedLlm: false };
  }
}

/** Replace the reinjected extractive digest system message after LLM enhance. */
export function replaceDroppedDigestInMessages(
  messages: AgentMessage[],
  nextDigest: string,
): AgentMessage[] {
  if (!nextDigest.trim()) {
    return messages;
  }
  let replaced = false;
  return messages.map((m) => {
    if (
      !replaced &&
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes("【压缩前对话蒸馏】")
    ) {
      replaced = true;
      return { ...m, content: nextDigest, timestamp: new Date().toISOString() };
    }
    return m;
  });
}
