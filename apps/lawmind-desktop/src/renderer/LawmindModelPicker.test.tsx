/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { LawmindModelPicker } from "./LawmindModelPicker";

function catalogRow(overrides: Partial<ModelCatalogEntry>): ModelCatalogEntry {
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

describe("LawmindModelPicker", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("exposes combobox semantics on the trigger", async () => {
    await act(async () => {
      root.render(
        <LawmindModelPicker
          catalog={[catalogRow({ id: "builtin:demo", label: "Demo Model" })]}
          selectedModelId="builtin:demo"
          onSelect={vi.fn()}
        />,
      );
    });
    const trigger = host.querySelector(".lm-model-picker-trigger") as HTMLButtonElement;
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens listbox with aria-controls and option ids", async () => {
    await act(async () => {
      root.render(
        <LawmindModelPicker
          catalog={[catalogRow({ id: "builtin:demo", label: "Demo Model" })]}
          selectedModelId="builtin:demo"
          onSelect={vi.fn()}
        />,
      );
    });
    const trigger = host.querySelector(".lm-model-picker-trigger") as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const listbox = host.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox).toBeTruthy();
    expect(trigger.getAttribute("aria-controls")).toBe(listbox.id);
    expect(host.querySelector(`[id="${listbox.id}-opt-builtin:demo"]`)).toBeTruthy();
  });
});
