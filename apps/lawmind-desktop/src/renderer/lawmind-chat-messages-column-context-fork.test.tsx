/**
 * @vitest-environment jsdom
 *
 * 「续接 UI」在对话列上的**接线**测试。
 *
 * 测的是这一层的三件事，而不是组件自己会不会渲染（那由
 * `LawmindMsgCarryoverNotice.test.tsx` / `LawmindContextForkSuggestion.test.tsx` 覆盖）：
 *   1. `contextFork` 经 5 层 props 链传到消息列后，续接来源卡真的出现在对话顶部；
 *   2. 建议卡只在父层说「该提示」时出现（父层负责判定 + 已关闭持久化）；
 *   3. 两个按钮的回调打到父层给的 handler（`onFork` / `onDismiss`）。
 *
 * 真机/浏览器层的端到端（点 fork → 切会话 → 卡出现）在 `e2e/context-fork.spec.ts`。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMsg } from "./lawmind-chat";
import { LawmindChatMessagesColumn } from "./lawmind-chat-shell";
import type { ChatContextForkProps } from "./LawmindContextForkSuggestion";

const MESSAGES: ChatMsg[] = [
  { role: "user", text: "起草竞业限制解除条款" },
  { role: "assistant", text: "已定位《劳动合同法》第23条。" },
];

describe("LawmindChatMessagesColumn · 上下文续接接线", () => {
  let host: HTMLDivElement;
  let root: Root;

  function render(contextFork?: ChatContextForkProps) {
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
        {...(contextFork ? { contextFork } : {})}
      />
    );
  }

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

  it("带上 carriedOverFrom 时，对话顶部出现续接来源卡（含摘要预览）", async () => {
    await act(async () => {
      root.render(
        render({
          carriedOverFrom: {
            sessionId: "s-source",
            title: "竞业限制解除",
            digestSource: "llm",
            digestChars: 1_240,
            droppedMessageCount: 18,
            digestPreview: "【压缩前对话蒸馏】摘要：已写到解除条款。",
          },
        }),
      );
    });
    const notice = host.querySelector('[data-testid="lm-msg-carryover-notice"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toContain("本对话续接自「竞业限制解除」");
    expect(notice?.textContent).toContain("整理 18 条");
    expect(notice?.textContent).toContain("已写到解除条款");
    // 没有 carriedOverFrom 的普通会话不该平白多一张卡。
    await act(async () => {
      root.render(render());
    });
    expect(host.querySelector('[data-testid="lm-msg-carryover-notice"]')).toBeNull();
  });

  it("建议卡只在 showSuggestion 为真时出现，按钮打到父层 handler", async () => {
    const onFork = vi.fn();
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(render({ showSuggestion: false, onFork, onDismiss }));
    });
    expect(host.querySelector('[data-testid="lm-ctx-fork-suggest"]')).toBeNull();

    await act(async () => {
      root.render(render({ showSuggestion: true, onFork, onDismiss }));
    });
    const suggest = host.querySelector('[data-testid="lm-ctx-fork-suggest"]');
    expect(suggest).toBeTruthy();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-go"]')?.click();
    });
    expect(onFork).toHaveBeenCalledTimes(1);
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-dismiss"]')
        ?.click();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("busy 时按钮禁用（不会连点出第二个新会话）", async () => {
    await act(async () => {
      root.render(render({ showSuggestion: true, busy: true, onFork: vi.fn() }));
    });
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-go"]')?.disabled,
    ).toBe(true);
    expect(
      host.querySelector<HTMLButtonElement>('[data-testid="lm-ctx-fork-suggest-dismiss"]')?.disabled,
    ).toBe(true);
  });
});
