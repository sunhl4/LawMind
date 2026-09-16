import { describe, expect, it } from "vitest";
import {
  assistantOutputLooksTruncated,
  extractAssistantText,
  shouldResampleSidecarJson,
} from "./assistant-text.js";

describe("extractAssistantText", () => {
  it("prefers content over reasoning_content", () => {
    expect(
      extractAssistantText({
        choices: [
          {
            message: { content: ' {"verdict":"pass"} ', reasoning_content: "think" },
            finish_reason: "stop",
          },
        ],
      }),
    ).toEqual({ text: '{"verdict":"pass"}', finishReason: "stop" });
  });

  it("falls back to reasoning_content when content is empty", () => {
    expect(
      extractAssistantText({
        choices: [{ message: { content: "  ", reasoning_content: '{"verdict":"fail"}' } }],
      }).text,
    ).toBe('{"verdict":"fail"}');
  });

  it("treats length / max_tokens finish as truncated", () => {
    expect(assistantOutputLooksTruncated({ text: "{", finishReason: "length" })).toBe(true);
    expect(assistantOutputLooksTruncated({ text: "ok", finishReason: "stop" })).toBe(false);
  });
});

describe("shouldResampleSidecarJson", () => {
  it("resamples empty or truncated draws while attempts remain", () => {
    expect(
      shouldResampleSidecarJson({ parsed: false, truncated: false, attempt: 0, attempts: 3 }),
    ).toBe(true);
    expect(
      shouldResampleSidecarJson({ parsed: true, truncated: true, attempt: 0, attempts: 3 }),
    ).toBe(true);
  });

  it("keeps a complete parse, and accepts a truncated parse only on the last draw", () => {
    expect(
      shouldResampleSidecarJson({ parsed: true, truncated: false, attempt: 0, attempts: 3 }),
    ).toBe(false);
    expect(
      shouldResampleSidecarJson({ parsed: true, truncated: true, attempt: 2, attempts: 3 }),
    ).toBe(false);
    expect(
      shouldResampleSidecarJson({ parsed: false, truncated: true, attempt: 2, attempts: 3 }),
    ).toBe(false);
  });
});
