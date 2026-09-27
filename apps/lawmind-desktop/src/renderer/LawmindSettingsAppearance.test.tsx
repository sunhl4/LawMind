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

  it("offers three distinct font sizes and keeps 标准 as the default", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    const group = host.querySelector('[aria-label="界面字号"]') as HTMLElement;
    const labels = [...group.querySelectorAll('[role="radio"]')].map((node) => node.textContent);
    expect(labels).toEqual(["小一点", "标准", "大一点"]);
    expect(host.querySelector("#lm-font-scale-hint")?.textContent).toContain("对话、在办、文书");
    expect(group.getAttribute("aria-describedby")).toBe("lm-font-scale-hint");
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("标准");
    expect(document.documentElement.dataset.lmFontScale).toBeUndefined();

    const small = group.querySelector('[role="radio"][aria-checked="false"]') as HTMLButtonElement;
    await act(async () => {
      small.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.dataset.lmFontScale).toBe("small");

    const large = [...group.querySelectorAll('[role="radio"]')].find((node) => node.textContent === "大一点") as HTMLButtonElement;
    await act(async () => {
      large.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.dataset.lmFontScale).toBe("large");
  });

  it("applies compact density class when selected", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    const compact = host.querySelector('[aria-label="界面密度"] [role="radio"][aria-checked="false"]');
    expect(compact?.textContent).toBe("紧凑");
    await act(async () => {
      compact?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("lm-density-compact")).toBe(true);
  });

  it("keeps lawyer review prefs and hides engineer controls", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    expect(host.querySelector('[data-testid="lm-require-signoff-review"]')).toBeTruthy();
    expect(host.textContent).toContain("待审稿进待拍板");
    expect(host.querySelector('[data-testid="lm-auto-export-on-approve"]')).toBeTruthy();
    expect(host.textContent).toContain("通过后生成 Word");
    expect(host.querySelector('[data-testid="lm-ui-theme"]')).toBeTruthy();
    expect(host.textContent).not.toContain("展开工具轨迹");
    expect(host.textContent).not.toContain("减弱动效");
    expect(host.textContent).not.toContain("特权");
    expect(host.querySelector("[data-testid=lm-doctor-word-addin]")).toBeNull();
    const signoff = host.querySelector('[data-testid="lm-require-signoff-review"]');
    expect(signoff?.closest("label")?.textContent).toContain("待审稿进待拍板");
    const hintId = signoff?.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    expect(host.querySelector(`#${hintId}`)?.textContent).toContain("通过或驳回");
    expect(host.querySelector("[aria-describedby=lm-appearance-layout-hint]")).toBeTruthy();
    const author = host.querySelector(
      "[data-testid=lm-word-revision-author]",
    ) as HTMLInputElement;
    expect(author.placeholder).toBe("LawMind");
    expect(author.disabled).toBe(true);
  });

  it("saves a Word revision author from the appearance settings", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body;
      const sent =
        typeof body === "string" ? (JSON.parse(body) as { wordRevisionAuthor?: string }) : {};
      const stored = sent.wordRevisionAuthor?.trim() ? sent.wordRevisionAuthor.trim() : "";
      if (!init?.method || init.method === "GET") {
        return new Response(JSON.stringify({ ok: true, wordRevisionAuthor: "赵律师" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true, wordRevisionAuthor: stored }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<LawmindSettingsAppearance apiBase="http://127.0.0.1:9" onPrefsChange={vi.fn()} />);
    });
    const input = host.querySelector("[data-testid=lm-word-revision-author]") as HTMLInputElement;
    expect(input.value).toBe("赵律师");
    expect(input.disabled).toBe(false);

    await act(async () => {
      // React controlled input: need the native setter (same pattern as TurnPlanCard tests).
      // eslint-disable-next-line typescript/unbound-method -- Descriptor#set is bound via .call below.
      const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setNativeValue?.call(input, "钱律师");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    const patches = fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.[0]).toBe("http://127.0.0.1:9/api/policy/workspace");
    const patchBody = patches[0]?.[1]?.body;
    expect(JSON.parse(typeof patchBody === "string" ? patchBody : "")).toEqual({
      wordRevisionAuthor: "钱律师",
    });
    expect(input.value).toBe("钱律师");
    expect(host.textContent).toContain("之后的 Word 修订用这个署名。");
  });

  it("applies the dark theme and moves density with the arrow key", async () => {
    await act(async () => {
      root.render(<LawmindSettingsAppearance onPrefsChange={vi.fn()} />);
    });
    const dark = host.querySelector('[aria-label="配色主题"] [role="radio"][aria-checked="false"]');
    expect(dark?.textContent).toBe("深色");
    await act(async () => {
      dark?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.documentElement.classList.contains("lm-theme-dark")).toBe(true);

    const group = host.querySelector('[aria-label="界面密度"]') as HTMLElement;
    const current = group.querySelector('[aria-checked="true"]') as HTMLButtonElement;
    current.focus();
    await act(async () => {
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(document.documentElement.classList.contains("lm-density-compact")).toBe(true);
  });
});
