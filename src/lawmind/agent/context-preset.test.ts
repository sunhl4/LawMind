import { describe, expect, it } from "vitest";
import {
  contextTokensForConversation,
  DEFAULT_CONVERSATION_LENGTH,
  normalizeConversationLength,
  resolveConversationLength,
} from "./context-preset.js";

describe("conversation length presets", () => {
  it("defaults to 200K and maps the old two-tier names", () => {
    expect(DEFAULT_CONVERSATION_LENGTH).toBe("200k");
    expect(resolveConversationLength(undefined)).toBe("200k");
    expect(resolveConversationLength("nope")).toBe("200k");
    expect(normalizeConversationLength("nope")).toBeUndefined();
    expect(resolveConversationLength("daily")).toBe("200k");
    expect(resolveConversationLength("dossier")).toBe("1m");
    expect(resolveConversationLength("500k")).toBe("500k");
  });

  it("caps a 1M model at the selected tier, and keeps a shorter model as-is", () => {
    expect(contextTokensForConversation(1_000_000, "200k")).toBe(200_000);
    expect(contextTokensForConversation(1_048_576, "500k")).toBe(500_000);
    expect(contextTokensForConversation(1_048_576, "1m")).toBe(1_000_000);
    expect(contextTokensForConversation(128_000, "1m")).toBe(128_000);
    expect(contextTokensForConversation(undefined, "200k")).toBe(200_000);
  });
});
