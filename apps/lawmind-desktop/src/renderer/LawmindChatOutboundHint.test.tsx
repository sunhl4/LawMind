/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatOutboundHint } from "./LawmindChatOutboundHint";
import { LAWMIND_OUTBOUND_CHANGED } from "./lawmind-desk-outbound";

vi.mock("./lawmind-requires-action", () => ({
  loadActionSummary: vi.fn(async () => ({
    automationInbox: [
      {
        id: "in-1",
        automationId: "chat-send-email-handoff",
        matterId: "m1",
        title: "待发信：催款",
        summary: "",
        status: "open",
        createdAt: "2026-10-01T00:00:00.000Z",
        pendingSend: { to: "a@b.com", subject: "催款", body: "请查收" },
      },
    ],
  })),
}));

describe("LawmindChatOutboundHint", () => {
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

  it("shows a primary CTA when the matter has pending outbound mail", async () => {
    await act(async () => {
      root.render(<LawmindChatOutboundHint apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const bar = host.querySelector('[data-testid="lm-chat-outbound-hint"]');
    expect(bar?.textContent).toContain("本案有 1 封待发出");
    expect(bar?.textContent).toContain("批准才会寄出");
    expect(host.querySelector('[data-testid="lm-chat-outbound-hint-open"]')?.textContent).toBe(
      "去批准发送",
    );
  });

  it("refreshes when outbound-changed fires", async () => {
    const { loadActionSummary } = await import("./lawmind-requires-action");
    await act(async () => {
      root.render(<LawmindChatOutboundHint apiBase="http://127.0.0.1:9" matterId="m1" />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const calls = vi.mocked(loadActionSummary).mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new CustomEvent(LAWMIND_OUTBOUND_CHANGED));
      await Promise.resolve();
    });
    expect(vi.mocked(loadActionSummary).mock.calls.length).toBeGreaterThan(calls);
  });
});
