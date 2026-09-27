/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindSettingsConversationLength } from "./LawmindSettingsConversationLength";

describe("LawmindSettingsConversationLength", () => {
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
    vi.unstubAllGlobals();
  });

  it("switches 200K, 500K, and 1M through the compose control", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        return new Response(JSON.stringify({ ok: true, conversationLength: "200k" }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<LawmindSettingsConversationLength apiBase="http://127.0.0.1:9" />);
    });
    const select = host.querySelector(
      "[data-testid='lm-compose-context-length-select']",
    ) as HTMLSelectElement;
    expect(select.value).toBe("200k");
    expect(select.textContent).toContain("200K（默认）");
    expect(select.textContent).toContain("500K");
    expect(select.textContent).toContain("1M");

    // eslint-disable-next-line typescript/unbound-method -- 原型 setter，下一行以 select 为 this 调用
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    for (const next of ["500k", "1m"] as const) {
      await act(async () => {
        setter?.call(select, next);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(select.value).toBe(next);
    }

    const patches = fetchMock.mock.calls.filter((call) => {
      const init = call[1];
      return init?.method === "PATCH";
    });
    expect(
      patches.map((call) => {
        const body = (call[1] as RequestInit).body;
        return JSON.parse(typeof body === "string" ? body : "") as unknown;
      }),
    ).toEqual([
      { conversationLength: "500k" },
      { conversationLength: "1m" },
    ]);
    expect(patches[0]?.[0]).toBe("http://127.0.0.1:9/api/policy/workspace");
    expect(patches[1]?.[0]).toBe("http://127.0.0.1:9/api/policy/workspace");
  });
});
