/**
 * Optional LLM re-summarization of extractive compact digests (manual compact path).
 * Turn-time auto-compact stays extractive-only for latency.
 */

import {
  modelAttemptBudget,
  shouldRetryTransportFailure,
  waitModelRetry,
} from "../llm/http-retry.js";
import { resolveClassifySidecarLimits } from "../models/capability-envelope.js";
import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "./assistant-text.js";
import { buildDroppedSpanDigest, resolveCompactDigestCharCap } from "./compact.js";
import { callModelWithRetry, ModelCallUserAbortError } from "./runtime-model-call.js";
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
    const line = `${msg.role === "user" ? "律师" : "助手"}：${text}`;
    if (used + line.length > maxChars) {
      break;
    }
    parts.push(line);
    used += line.length + 1;
  }
  return parts.join("\n");
}

const MIN_COMPACT_SUMMARY_CHARS = 40;

function mergeCompactDigest(summary: string, extractive: string, cap: number): string {
  const header = `【压缩前对话蒸馏】摘要：\n${summary.slice(0, Math.floor(cap * 0.45))}`;
  const merged = `${header}\n\n---\n\n${extractive}`;
  return merged.length > cap ? `${merged.slice(0, Math.max(0, cap - 20))}\n…[蒸馏截断]` : merged;
}

/**
 * Enhance extractive digest with a short model summary. On any failure, returns extractive.
 */
export async function enhanceCompactDigestWithLlm(opts: {
  model: AgentModelConfig;
  extractiveDigest: string;
  dropped: AgentMessage[];
  contextTokens?: number;
  abortSignal?: AbortSignal;
}): Promise<{ digest: string; usedLlm: boolean }> {
  const extractive = opts.extractiveDigest.trim();
  if (!extractive || !isCompactLlmDigestEnabled()) {
    return { digest: extractive, usedLlm: false };
  }

  const cap = resolveCompactDigestCharCap(opts.contextTokens);
  const limits = resolveClassifySidecarLimits({
    contextTokens: opts.contextTokens ?? opts.model.contextTokens,
    timeoutMs: opts.model.timeoutMs,
  });

  const snippet = dialogueSnippet(opts.dropped, Math.floor(cap * 0.6));
  const userContent = [
    "请将下列法律助理对话摘录压缩为连贯中文摘要。",
    "保留：律师意图、关键当事人/标的、已做工具动作、待办与风险。",
    "不要编造未出现的事实；不要输出 JSON。",
    "",
    "【提取式要点】",
    extractive.slice(0, cap),
    "",
    "【对话摘录】",
    snippet || "（无正文摘录）",
  ].join("\n");

  const fallback = (): { digest: string; usedLlm: boolean } => ({
    digest: extractive || buildDroppedSpanDigest(opts.dropped, cap),
    usedLlm: false,
  });

  const attempts = modelAttemptBudget();
  let lastSummary = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await callModelWithRetry(
        {
          ...opts.model,
          maxTokens: limits.maxTokens,
          timeoutMs: limits.timeoutMs,
          temperature: limits.temperature,
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
        { signal: opts.abortSignal },
      );
      const view = extractAssistantText(response);
      const summary = view.text.replace(/\s+/g, " ").trim();
      lastSummary = summary;
      const usable = summary.length >= MIN_COMPACT_SUMMARY_CHARS;
      if (
        shouldResampleSidecarJson({
          parsed: usable,
          truncated: assistantOutputLooksTruncated(view),
          attempt,
          attempts,
        })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      if (!usable) {
        return fallback();
      }
      return { digest: mergeCompactDigest(summary, extractive, cap), usedLlm: true };
    } catch (err) {
      if (err instanceof ModelCallUserAbortError) {
        throw err;
      }
      if (
        attempt + 1 < attempts &&
        shouldRetryTransportFailure(err, { signal: opts.abortSignal })
      ) {
        await waitModelRetry(attempt);
        continue;
      }
      return fallback();
    }
  }
  if (lastSummary.length >= MIN_COMPACT_SUMMARY_CHARS) {
    return { digest: mergeCompactDigest(lastSummary, extractive, cap), usedLlm: true };
  }
  return fallback();
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
