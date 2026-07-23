import { afterEach, describe, expect, it } from "vitest";
import {
  applyEnvelopeToAgentModelDefaults,
  resolveCapabilityEnvelope,
} from "./capability-envelope.js";

const ENV_KEYS = [
  "LAWMIND_AGENT_MAX_TOKENS",
  "LAWMIND_MODEL_CONTEXT_TOKENS",
  "LAWMIND_AGENT_TIMEOUT_MS",
  "LAWMIND_TOOL_TIMEOUT_MS",
  "LAWMIND_CHARS_PER_TOKEN",
] as const;

describe("resolveCapabilityEnvelope", () => {
  const prev: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (prev[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
      delete prev[key];
    }
  });

  function clearEnv(): void {
    for (const key of ENV_KEYS) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("scales maxOutput with context window (not stuck at 4096)", () => {
    clearEnv();
    const small = resolveCapabilityEnvelope({ contextTokens: 8_192 });
    const large = resolveCapabilityEnvelope({ contextTokens: 131_072 });
    expect(small.maxOutputTokens).toBeGreaterThanOrEqual(4_096);
    expect(large.maxOutputTokens).toBeGreaterThan(small.maxOutputTokens);
    expect(large.maxOutputTokens).toBeGreaterThan(4096);
    // 20% of 131072
    expect(large.maxOutputTokens).toBe(Math.floor(131_072 * 0.2));
  });

  it("raises tool/history budgets for large windows", () => {
    clearEnv();
    const large = resolveCapabilityEnvelope({ contextTokens: 128_000 });
    expect(large.toolCallsPerTurn).toBeGreaterThanOrEqual(30);
    expect(large.maxHistoryMessages).toBeGreaterThanOrEqual(100);
  });

  it("honors LAWMIND_AGENT_MAX_TOKENS override", () => {
    clearEnv();
    process.env.LAWMIND_AGENT_MAX_TOKENS = "12000";
    const env = resolveCapabilityEnvelope({ contextTokens: 128_000 });
    expect(env.maxOutputTokens).toBe(12_000);
  });

  it("draft task kind uses higher output ratio", () => {
    clearEnv();
    const chat = resolveCapabilityEnvelope({ contextTokens: 100_000, taskKind: "chat" });
    const draft = resolveCapabilityEnvelope({ contextTokens: 100_000, taskKind: "draft" });
    expect(draft.maxOutputTokens).toBeGreaterThan(chat.maxOutputTokens);
  });

  it("applyEnvelopeToAgentModelDefaults attaches contextTokens", () => {
    clearEnv();
    const defaults = applyEnvelopeToAgentModelDefaults({ contextTokens: 64_000 });
    expect(defaults.contextTokens).toBe(64_000);
    expect(defaults.maxTokens).toBeGreaterThan(4096);
    expect(defaults.timeoutMs).toBeGreaterThan(0);
  });
});
