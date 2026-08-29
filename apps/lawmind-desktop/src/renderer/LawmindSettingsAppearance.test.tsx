/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsAppearance } from "./LawmindSettingsAppearance";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("LawmindSettingsAppearance", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
    document.documentElement.className = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("applies compact density class when selected", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    const select = host.querySelector('select[aria-label="界面密度"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    await act(async () => {
      select.value = "compact";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("lm-density-compact")).toBe(true);
  });

  it("hosts 签批后自动导出 on appearance page", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    expect(host.querySelector('[data-testid="lm-require-signoff-review"]')).toBeTruthy();
    expect(host.textContent).toContain("审核签批审阅");
    expect(host.querySelector('[data-testid="lm-auto-export-on-approve"]')).toBeTruthy();
    expect(host.textContent).toContain("签批后自动导出 Word");
    expect(host.querySelector('[data-testid="lm-show-tool-trace"]')).toBeTruthy();
    expect(host.textContent).toContain("展开工具轨迹");
  });
});
