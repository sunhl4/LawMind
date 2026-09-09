/**
 * Model-aware capability envelope — scale output, context budget, and tool
 * budgets from the selected model's context window instead of fixed hard caps.
 */

import { parseToolTimeoutMsEnv } from "../runtime/tool-timeout-env.js";

export type CapabilityTaskKind = "chat" | "draft" | "review" | "classify" | "plan";

export type ModelCapabilityEnvelope = {
  contextTokens: number;
  maxOutputTokens: number;
  charsPerToken: number;
  toolCallsPerTurn: number;
  toolTimeoutMs: number;
  modelTimeoutMs: number;
  /** Multiplier for CASE / memory prompt windows (0.5–2.5). */
  promptWindowScale: number;
  /** Soft history message keep target before compact-by-count. */
  maxHistoryMessages: number;
};

const DEFAULT_CONTEXT_TOKENS = 128_000;
/** Prefer generous output; env can still raise/lower. */
const MAX_OUTPUT_HARD_CAP = 65_536;
const MIN_OUTPUT_TOKENS = 4_096;

function parsePositiveIntEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function outputRatioForTask(taskKind: CapabilityTaskKind | undefined): number {
  switch (taskKind) {
    case "draft":
    case "review":
      return 0.25;
    case "plan":
      return 0.15;
    case "classify":
      return 0.05;
    case "chat":
    default:
      return 0.2;
  }
}

function toolCallsForContext(contextTokens: number): number {
  if (contextTokens >= 200_000) {
    return 40;
  }
  if (contextTokens >= 100_000) {
    return 30;
  }
  if (contextTokens >= 32_000) {
    return 25;
  }
  return 20;
}

function historyForContext(contextTokens: number): number {
  if (contextTokens >= 200_000) {
    return 120;
  }
  if (contextTokens >= 100_000) {
    return 100;
  }
  if (contextTokens >= 32_000) {
    return 80;
  }
  return 50;
}

/**
 * Resolve runtime limits from catalog context window + optional overrides.
 * Artificial floors are kept low; ceilings track the model rather than a fixed 4096.
 */
export function resolveCapabilityEnvelope(opts: {
  contextTokens?: number;
  maxTokensOverride?: number;
  taskKind?: CapabilityTaskKind;
  timeoutMs?: number;
  charsPerToken?: number;
}): ModelCapabilityEnvelope {
  const envContext = parsePositiveIntEnv("LAWMIND_MODEL_CONTEXT_TOKENS");
  const contextTokens = Math.max(4_096, opts.contextTokens ?? envContext ?? DEFAULT_CONTEXT_TOKENS);
  const modelTimeoutMs =
    opts.timeoutMs ?? parsePositiveIntEnv("LAWMIND_AGENT_TIMEOUT_MS") ?? 120_000;
  const envMaxOut = parsePositiveIntEnv("LAWMIND_AGENT_MAX_TOKENS");
  const ratio = outputRatioForTask(opts.taskKind);
  const computedOut = Math.floor(contextTokens * ratio);
  const maxOutputTokens = Math.min(
    MAX_OUTPUT_HARD_CAP,
    Math.max(MIN_OUTPUT_TOKENS, opts.maxTokensOverride ?? envMaxOut ?? computedOut),
  );
  const charsPerToken =
    typeof opts.charsPerToken === "number" && opts.charsPerToken > 0
      ? opts.charsPerToken
      : (parsePositiveIntEnv("LAWMIND_CHARS_PER_TOKEN") ?? 4);
  const promptWindowScale = Math.min(2.5, Math.max(0.5, contextTokens / 128_000));

  return {
    contextTokens,
    maxOutputTokens,
    charsPerToken,
    toolCallsPerTurn: toolCallsForContext(contextTokens),
    toolTimeoutMs: parseToolTimeoutMsEnv(0),
    modelTimeoutMs,
    promptWindowScale,
    maxHistoryMessages: historyForContext(contextTokens),
  };
}

/** Sampling temperature by task kind (E2); override via opts.temperature / env. */
export function resolveTemperatureForTask(
  taskKind?: CapabilityTaskKind,
  override?: number,
): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return Math.min(1.5, Math.max(0, override));
  }
  const envRaw = process.env.LAWMIND_AGENT_TEMPERATURE?.trim();
  if (envRaw) {
    const n = Number(envRaw);
    if (Number.isFinite(n)) {
      return Math.min(1.5, Math.max(0, n));
    }
  }
  switch (taskKind) {
    case "classify":
    case "plan":
      return 0.15;
    case "draft":
    case "review":
      return 0.5;
    case "chat":
    default:
      return 0.35;
  }
}

/** Attach envelope fields onto a resolved agent model config. */
export function applyEnvelopeToAgentModelDefaults(opts: {
  contextTokens?: number;
  temperature?: number;
  taskKind?: CapabilityTaskKind;
}): {
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  contextTokens: number;
} {
  const envelope = resolveCapabilityEnvelope({
    contextTokens: opts.contextTokens,
    taskKind: opts.taskKind,
  });
  return {
    maxTokens: envelope.maxOutputTokens,
    temperature: resolveTemperatureForTask(opts.taskKind ?? "chat", opts.temperature),
    timeoutMs: envelope.modelTimeoutMs,
    contextTokens: envelope.contextTokens,
  };
}
