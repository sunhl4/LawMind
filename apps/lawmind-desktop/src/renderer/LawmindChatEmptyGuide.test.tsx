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

  it("shows create matter and workflow actions when guide is enabled", async () => {
    const onCreateMatter = vi.fn();
    const onOpenWorkflowLibrary = vi.fn();
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
          onRemoveFileChatPill={vi.fn()}
          onClearFileChatPills={vi.fn()}
          contextTaskId={null}
          apiBase="http://127.0.0.1:1"
          onResumeRequiresAction={vi.fn()}
          showEmptyMatterGuide
          onCreateMatter={onCreateMatter}
          onOpenWorkflowLibrary={onOpenWorkflowLibrary}
        />,
      );
    });
    expect(host.textContent).toContain("新建案件");
    expect(host.textContent).toContain("打开工作流库");
  });
});
