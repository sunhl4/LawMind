/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatMessagesColumn } from "./lawmind-chat-shell";

describe("LawmindChatMessagesColumn empty guide", () => {
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

  it("keeps empty chat clean and points to 办件", async () => {
    await act(async () => {
      root.render(
        <LawmindChatMessagesColumn
          selectedAssistantId="a1"
          currentMessages={[]}
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
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-chat-empty"]')).toBeTruthy();
    expect(host.textContent).toContain("开始对话");
    expect(host.textContent).toContain("拖入或点「办件」");
    expect(host.textContent).not.toMatch(/拖入或 \+/);
    expect(host.querySelector('[data-testid="lm-contract-fast-lane"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-empty-desk-verbs"]')).toBeNull();
    expect(host.querySelector('[data-testid="lm-empty-more"]')).toBeNull();
    expect(host.querySelector(".lm-scenario-card")).toBeNull();
  });
});
