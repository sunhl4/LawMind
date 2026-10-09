import { describe, expect, it } from "vitest";
import {
  builtinIdForEnvModelName,
  contextTokensForUpstreamModel,
  getBuiltinModelById,
  isDeepSeekFlashUpstream,
  LAWMIND_DEFAULT_BUILTIN_MODEL_ID,
  LAWMIND_DEFAULT_UPSTREAM_MODEL,
} from "./catalog.js";

describe("lawmind models catalog", () => {
  it("uses deepseek-flash as the product default", () => {
    const flash = getBuiltinModelById(LAWMIND_DEFAULT_BUILTIN_MODEL_ID);
    expect(flash?.model).toBe("deepseek-flash");
    expect(flash?.model).toBe(LAWMIND_DEFAULT_UPSTREAM_MODEL);
    expect(builtinIdForEnvModelName("deepseek-flash")).toBe(LAWMIND_DEFAULT_BUILTIN_MODEL_ID);
  });

  it("records vendor context windows instead of the old 8k–32k stubs", () => {
    expect(getBuiltinModelById("builtin:qwen-plus")?.contextTokens).toBe(1_000_000);
    expect(getBuiltinModelById("builtin:qwen-turbo")?.contextTokens).toBe(1_000_000);
    expect(getBuiltinModelById("builtin:qwen-max")?.contextTokens).toBe(1_000_000);
    expect(getBuiltinModelById("builtin:qwen3.5-plus")?.contextTokens).toBe(1_000_000);
    expect(getBuiltinModelById("builtin:deepseek-chat")?.contextTokens).toBe(131_072);
    expect(getBuiltinModelById("builtin:deepseek-reasoner")?.contextTokens).toBe(131_072);
    expect(getBuiltinModelById(LAWMIND_DEFAULT_BUILTIN_MODEL_ID)?.contextTokens).toBe(1_048_576);
    expect(contextTokensForUpstreamModel("deepseek-flash")).toBe(1_048_576);
    expect(contextTokensForUpstreamModel("deepseek-v4-flash")).toBe(1_048_576);
    expect(isDeepSeekFlashUpstream("deepseek-v4-flash-vision-exp")).toBe(true);
  });

  it("maps retired DeepSeek Flash aliases to deepseek-flash", () => {
    expect(builtinIdForEnvModelName("deepseek-v4-flash")).toBe(LAWMIND_DEFAULT_BUILTIN_MODEL_ID);
    expect(builtinIdForEnvModelName("deepseek-v4-flash-vision-exp")).toBe(
      LAWMIND_DEFAULT_BUILTIN_MODEL_ID,
    );
    expect(getBuiltinModelById("builtin:deepseek-v4-flash")?.model).toBe("deepseek-flash");
    expect(getBuiltinModelById("deepseek-v4-flash-vision-exp")?.id).toBe(
      LAWMIND_DEFAULT_BUILTIN_MODEL_ID,
    );
  });
});
