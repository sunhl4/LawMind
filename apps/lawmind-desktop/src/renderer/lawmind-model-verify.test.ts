import { describe, expect, it } from "vitest";
import {
  blockSendForUnconfiguredCatalogRow,
  isActiveModelVerified,
  isSelectedModelVerified,
} from "./lawmind-model-verify";
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

describe("blockSendForUnconfiguredCatalogRow", () => {
  it("does not open settings when health already has a configured model", () => {
    expect(
      blockSendForUnconfiguredCatalogRow({
        catalogRowConfigured: false,
        healthModelConfigured: true,
      }),
    ).toBe(false);
  });

  it("opens settings when the selected row has no key and health is not configured", () => {
    expect(
      blockSendForUnconfiguredCatalogRow({
        catalogRowConfigured: false,
        healthModelConfigured: false,
      }),
    ).toBe(true);
  });
});

describe("isSelectedModelVerified", () => {
  it("returns true when selected row has verifiedAt", () => {
    expect(isSelectedModelVerified([row], "builtin:qwen-plus")).toBe(true);
  });

  it("returns false when not verified", () => {
    const unverified = { ...row, verifiedAt: undefined };
    expect(isSelectedModelVerified([unverified], "builtin:qwen-plus")).toBe(false);
  });

  it("treats health.modelVerified as verified even before catalog refresh", () => {
    const unverified = { ...row, verifiedAt: undefined };
    expect(
      isActiveModelVerified({
        catalog: [unverified],
        selectedModelId: "builtin:qwen-plus",
        healthVerified: true,
      }),
    ).toBe(true);
  });
});
