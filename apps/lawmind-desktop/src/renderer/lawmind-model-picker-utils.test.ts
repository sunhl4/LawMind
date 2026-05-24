import { describe, it, expect } from "vitest";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import {
  filterModelCatalog,
  flattenGroupedCatalog,
  formatVerifiedAt,
  groupModelCatalog,
  nextSelectableIndex,
  providerIconKey,
  resolveComposeModelSelectValue,
} from "./lawmind-model-picker-utils";

function row(overrides: Partial<ModelCatalogEntry>): ModelCatalogEntry {
  return {
    id: "builtin:demo",
    kind: "builtin",
    label: "Demo",
    group: "通义千问",
    provider: "dashscope",
    model: "qwen-plus",
    baseUrl: "https://example.com/v1",
    configured: true,
    ...overrides,
  };
}

describe("groupModelCatalog", () => {
  it("orders 平台模型 → 当前配置 → 内置 → 自定义", () => {
    const catalog: ModelCatalogEntry[] = [
      row({ id: "custom:1", kind: "custom", group: "自定义模型", provider: "custom" }),
      row({ id: "builtin:qwen", group: "通义千问" }),
      row({ id: "platform:qwen", kind: "platform", group: "平台模型", provider: "platform" }),
      row({ id: "env:current", group: "当前配置" }),
    ];
    const groups = groupModelCatalog(catalog).map(([g]) => g);
    expect(groups).toEqual(["平台模型", "当前配置", "通义千问", "自定义模型"]);
  });
});

describe("resolveComposeModelSelectValue", () => {
  const catalog: ModelCatalogEntry[] = [
    row({ id: "builtin:a", configured: true }),
    row({ id: "builtin:b", configured: false }),
  ];
  it("returns the selection when configured", () => {
    expect(resolveComposeModelSelectValue(catalog, "builtin:a")).toBe("builtin:a");
  });
  it("falls back to the first configured row otherwise", () => {
    expect(resolveComposeModelSelectValue(catalog, "builtin:b")).toBe("builtin:a");
  });
  it("falls back to builtin:qwen-plus when nothing is configured", () => {
    const empty: ModelCatalogEntry[] = [row({ id: "builtin:b", configured: false })];
    expect(resolveComposeModelSelectValue(empty, "")).toBe("builtin:b");
    expect(resolveComposeModelSelectValue([], "")).toBe("builtin:qwen-plus");
  });
});

describe("filterModelCatalog", () => {
  const catalog: ModelCatalogEntry[] = [
    row({ id: "1", label: "通义千问 Plus", provider: "dashscope" }),
    row({ id: "2", label: "GPT-4o", provider: "openai", model: "gpt-4o" }),
  ];
  it("returns input on empty query", () => {
    expect(filterModelCatalog(catalog, "")).toHaveLength(2);
  });
  it("matches against label, model and provider", () => {
    expect(filterModelCatalog(catalog, "千问")).toHaveLength(1);
    expect(filterModelCatalog(catalog, "openai")).toHaveLength(1);
    expect(filterModelCatalog(catalog, "gpt-4o")).toHaveLength(1);
  });
});

describe("nextSelectableIndex", () => {
  const rows = [
    { row: row({ id: "a", configured: true }) },
    { row: row({ id: "b", configured: false }) },
    { row: row({ id: "c", configured: true }) },
  ];
  it("skips disabled rows", () => {
    expect(nextSelectableIndex(rows, 0, 1)).toBe(2);
    expect(nextSelectableIndex(rows, 2, 1)).toBe(0);
    expect(nextSelectableIndex(rows, 0, -1)).toBe(2);
  });
  it("returns -1 for empty input", () => {
    expect(nextSelectableIndex([], 0, 1)).toBe(-1);
  });
});

describe("flattenGroupedCatalog", () => {
  it("preserves order", () => {
    const flat = flattenGroupedCatalog([
      ["A", [row({ id: "1" }), row({ id: "2" })]],
      ["B", [row({ id: "3" })]],
    ]);
    expect(flat.map((f) => f.row.id)).toEqual(["1", "2", "3"]);
  });
});

describe("providerIconKey", () => {
  it("maps platform/custom kinds first", () => {
    expect(providerIconKey(row({ kind: "platform", provider: "platform" }))).toBe("platform");
    expect(providerIconKey(row({ kind: "custom", provider: "custom" }))).toBe("custom");
  });
  it("falls through to provider for builtins", () => {
    expect(providerIconKey(row({ provider: "deepseek" }))).toBe("deepseek");
    expect(providerIconKey(row({ provider: "moonshot" }))).toBe("moonshot");
  });
});

describe("formatVerifiedAt", () => {
  it("returns empty string on invalid input", () => {
    expect(formatVerifiedAt(undefined)).toBe("");
    expect(formatVerifiedAt("not a date")).toBe("");
  });
  it("formats ISO timestamps", () => {
    expect(formatVerifiedAt("2024-05-01T12:34:00.000Z")).toMatch(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    );
  });
});
