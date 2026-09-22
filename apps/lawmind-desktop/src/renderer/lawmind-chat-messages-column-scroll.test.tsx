/**
 * @vitest-environment jsdom
 *
 * Regression: the chat pane is unmounted whenever another main view (在办 /
 * 文书台 / 会议室), the settings panel, or the editor-only layout is shown. On
 * remount the transcript used to open at scrollTop 0 — the first message — so
 * the lawyer had to scroll down to the newest output by hand.
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMsg } from "./lawmind-chat";
import { LawmindChatMessagesColumn } from "./lawmind-chat-shell";

const PANEL_SCROLL_HEIGHT = 4800;

const MESSAGES: ChatMsg[] = [
  { role: "user", text: "帮我看看这份合同的风险" },
  { role: "assistant", text: "第一条……".repeat(60) },
];

describe("LawmindChatMessagesColumn lands on the latest turn when remounted", () => {
  let host: HTMLDivElement;
  let root: Root;

  function renderColumn() {
    return (
      <LawmindChatMessagesColumn
        selectedAssistantId="a1"
        currentMessages={MESSAGES}
        copiedMessageIndex={null}
        loading={false}
        messagesEndRef={{ current: null }}
        onCopyMessage={vi.fn()}
        onApplyPrompt={vi.fn()}
        onSendClarificationMessage={vi.fn()}
        fileChatPills={[]}
        contextTaskId={null}
        apiBase="http://127.0.0.1:1"
        onResumeRequiresAction={vi.fn()}
      />
    );
  }

  beforeEach(() => {
    // jsdom reports 0 for layout metrics; every overflow host pretends to be tall
    // so the scroll helpers have something to pin to.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return PANEL_SCROLL_HEIGHT;
      },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  });

  it("pins the transcript to the bottom as soon as it is mounted", async () => {
    await act(async () => {
      root.render(renderColumn());
    });

    const panel = document.getElementById("lawmind-chat-messages-panel");
    expect(panel).toBeTruthy();
    expect(panel?.scrollTop).toBe(PANEL_SCROLL_HEIGHT);
  });

  it("lands on the latest turn again after switching to another view and back", async () => {
    await act(async () => {
      root.render(renderColumn());
    });

    const before = document.getElementById("lawmind-chat-messages-panel");
    expect(before?.scrollTop).toBe(PANEL_SCROLL_HEIGHT);

    // Switching to 在办 / 文书台 / 会议室 unmounts the pane; the fresh DOM node
    // would start at scrollTop 0 unless the remount pins the latest turn.
    act(() => {
      root.unmount();
    });
    root = createRoot(host);

    await act(async () => {
      root.render(renderColumn());
    });

    const after = document.getElementById("lawmind-chat-messages-panel");
    expect(after).not.toBe(before);
    expect(after?.scrollTop).toBe(PANEL_SCROLL_HEIGHT);
  });
});
