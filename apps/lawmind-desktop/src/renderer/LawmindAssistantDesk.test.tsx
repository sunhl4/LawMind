/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindAssistantDesk } from "./LawmindAssistantDesk";

describe("LawmindAssistantDesk", () => {
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

  it("stays quiet when this assistant has no standing role", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify({ ok: true, desk: { visible: false } }),
        json: async () => ({ ok: true, desk: { visible: false } }),
      })),
    );
    await act(async () => {
      root.render(<LawmindAssistantDesk apiBase="http://127.0.0.1:9" assistantId="a1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="lm-assistant-desk"]')).toBeNull();
  });

  it("shows who they are and what happened while you were away", async () => {
    const body = {
      ok: true,
      desk: {
        displayName: "续签助手",
        presence: "blocked",
        presenceDetail: "等你拍板",
        responsibility: "盯合同到期",
        prohibitions: "外发前必须问我",
        standing: [{ title: "每天看续签", lastResult: "列出甲合同 6 月到期" }],
        visible: true,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => JSON.stringify(body),
        json: async () => body,
      })),
    );
    await act(async () => {
      root.render(<LawmindAssistantDesk apiBase="http://127.0.0.1:9" assistantId="a1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).toContain("续签助手");
    expect(host.textContent).toContain("停住了");
    expect(host.textContent).toContain("你不在时：每天看续签");
    expect(host.textContent).toContain("必须先问你：外发前必须问我");
  });
});
