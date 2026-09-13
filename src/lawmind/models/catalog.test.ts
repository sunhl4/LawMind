import { describe, expect, it } from "vitest";
import {
  builtinIdForEnvModelName,
  getBuiltinModelById,
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
