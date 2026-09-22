/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindOutboundSignoffCallout } from "./LawmindOutboundSignoffCallout";
import { readRequireSignoffReview } from "./lawmind-review-prefs";

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

describe("LawmindOutboundSignoffCallout", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
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

  it("reminds the lawyer and writes the 签批审阅 pref", async () => {
    await act(async () => {
      root.render(<LawmindOutboundSignoffCallout />);
    });
    expect(host.textContent).toContain("此流程会把材料发给别人");
    expect(host.textContent).toContain("签批审阅");
    expect(host.textContent).toContain("对所有案件生效");
    expect(host.textContent).toContain("批准发送");
    const box = host.querySelector(
      '[data-testid="lm-outbound-signoff-check"]',
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => {
      box.click();
    });
    expect(readRequireSignoffReview()).toBe(true);
  });
});
