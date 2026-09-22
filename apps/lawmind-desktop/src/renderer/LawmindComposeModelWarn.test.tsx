/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindChatComposeFooter } from "./lawmind-chat-shell";
import { mockComposeExtras } from "./test/mock-compose-extras";

describe("LawmindChatComposeFooter model warn", () => {
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

  it("shows model-not-configured callout when composeModelConfigured is false", async () => {
    await act(async () => {
      root.render(
        <LawmindChatComposeFooter
          currentMessages={[]}
          input=""
          loading={false}
          error={null}
          contextTaskId={null}
          contextMatterId={null}
          matterTitle={null}
          textareaRef={{ current: null }}
          onInputChange={() => {}}
          onSend={() => {}}
          onAbortChat={() => {}}
          onApplyPrompt={() => {}}
          onClearContext={() => {}}
          onOpenComposeSettings={vi.fn()}
          onOpenApiWizard={vi.fn()}
          composeModelHint={null}
          composeModelQuickTestBusy={false}
          onComposeModelQuickTest={vi.fn()}
          composeModelConfigured={false}
          modelCatalog={[]}
          selectedModelId="m1"
          onModelSelect={vi.fn()}
          onDelegateAssist={vi.fn()}
          allowWebSearch={false}
          onAllowWebSearchChange={() => {}}
          apiBase="http://127.0.0.1:1"
          chatSessionId="s1"
          fileChatPills={[]}
          onRemoveFileChatPill={() => {}}
          onClearFileChatPills={() => {}}
          composeExtras={mockComposeExtras()}
        />,
      );
    });
    expect(host.textContent).toMatch(/尚未配置可用的主模型 API/);
  });
});
