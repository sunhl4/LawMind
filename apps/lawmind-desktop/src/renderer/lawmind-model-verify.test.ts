import { describe, expect, it } from "vitest";
import { isSelectedModelVerified } from "./lawmind-model-verify";
import type { ModelCatalogEntry } from "./lawmind-models-api";

const row: ModelCatalogEntry = {
  id: "builtin:qwen-plus",
  kind: "builtin",
  label: "Qwen",
  group: "g",
  provider: "dashscope",
  model: "qwen-plus",
  baseUrl: "https://x",
  configured: true,
  verifiedAt: "2026-01-01T00:00:00.000Z",
};

describe("isSelectedModelVerified", () => {
  it("returns true when selected row has verifiedAt", () => {
    expect(isSelectedModelVerified([row], "builtin:qwen-plus")).toBe(true);
  });

  it("returns false when not verified", () => {
    const unverified = { ...row, verifiedAt: undefined };
    expect(isSelectedModelVerified([unverified], "builtin:qwen-plus")).toBe(false);
  });
});
