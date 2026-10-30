/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindWorkspaceMainPane, type LawmindWorkspaceMainPaneProps } from "./LawmindWorkspaceMainPane";
import { currentMiddleFile, setCurrentMiddleFile } from "../lawmind-middle-surface";

function minimalProps(
  overrides: Partial<LawmindWorkspaceMainPaneProps> = {},
): LawmindWorkspaceMainPaneProps {
  const noop = () => {};
  return {
    canUseFilesystemBridge: true,
    setFileEditorHost: noop,
    wsShowEditor: true,
    onShowEditorPane: noop,
    wsShowChat: false,
    onShowChatPane: noop,
    onWsChatSplitResize: noop,
    wsChatColWidth: 380,
    chatSessionList: [],
    chatSessionsLoading: false,
    loading: false,
    onSelectChatSession: noop,
    onCreateNewChatSession: noop,
    onRenameChatSession: noop,
    onDeleteChatSession: noop,
    config: null,
    currentMessages: [],
    copiedMessageIndex: null,
    messagesEndRef: { current: null },
    onCopyMessage: noop,
    onInputChange: noop,
    textareaRef: { current: null },
    onSendClarificationMessage: noop,
    streamCompactLabels: [],
    fileChatContextItems: [],
    onRemoveFileChatPill: noop,
    onClearFileChatPills: noop,
    contextTaskId: null,
    onOpenReview: noop,
    delegateAssistEnabled: false,
    revisionBackgroundActive: false,
    onResumeRequiresAction: noop,
    input: "",
    error: null,
    contextMatterId: null,
    chatMatterHeadline: null,
    onSend: noop,
    onAbortChat: noop,
    onClearContext: noop,
    onOpenComposeSettings: noop,
    onOpenApiWizard: noop,
    composeModelHint: null,
    composeModelQuickTestBusy: false,
    onComposeModelQuickTest: noop,
    modelCatalog: [],
    selectedModelId: "m1",
    onModelSelect: noop,
    allowWebSearch: false,
    onAllowWebSearchChange: noop,
    queuedMessages: [],
    cancelQueuedMessage: noop,
    onOpenTaskDrawer: noop,
    composeExtras: {} as LawmindWorkspaceMainPaneProps["composeExtras"],
    paneDetach: {
      chatDetached: false,
      middleDetached: false,
      onChatPaneDetached: noop,
      onMiddlePaneDetached: noop,
    },
    ...overrides,
  } as LawmindWorkspaceMainPaneProps;
}

describe("LawmindWorkspaceMainPane middle detach", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    setCurrentMiddleFile(null);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    setCurrentMiddleFile(null);
    delete window.lawmindDesktop;
  });

  it("renders the middle grip and opens a middle pane window with the current file", async () => {
    setCurrentMiddleFile({ root: "workspace", relPath: "artifacts/chart.html" });
    const onMiddlePaneDetached = vi.fn();
    const openAuxWindow = vi.fn(async () => ({
      ok: true,
      key: "workspace-pane:middle:workspace:artifacts/chart.html",
    }));
    window.lawmindDesktop = { openAuxWindow } as unknown as typeof window.lawmindDesktop;

    await act(async () => {
      root.render(
        <LawmindWorkspaceMainPane
          {...minimalProps({
            paneDetach: {
              chatDetached: false,
              middleDetached: false,
              onChatPaneDetached: () => {},
              onMiddlePaneDetached,
            },
          })}
        />,
      );
    });

    const grip = host.querySelector<HTMLButtonElement>(
      '[data-testid="lm-pane-detach-grip-middle"]',
    );
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute("aria-label")).toContain("中栏");
    expect(currentMiddleFile()).toEqual({
      root: "workspace",
      relPath: "artifacts/chart.html",
    });

    await act(async () => {
      grip?.click();
      await Promise.resolve();
    });

    expect(openAuxWindow).toHaveBeenCalledTimes(1);
    expect(openAuxWindow).toHaveBeenCalledWith({
      kind: "workspace-pane",
      pane: "middle",
      title: "中栏",
      middleView: "file",
      relPath: "artifacts/chart.html",
      root: "workspace",
    });
    expect(onMiddlePaneDetached).toHaveBeenCalledWith(
      "workspace-pane:middle:workspace:artifacts/chart.html",
    );
  });

  it("hides the middle content (and grip) while a middle window is detached", async () => {
    await act(async () => {
      root.render(
        <LawmindWorkspaceMainPane
          {...minimalProps({
            paneDetach: {
              chatDetached: false,
              middleDetached: true,
              onChatPaneDetached: () => {},
              onMiddlePaneDetached: () => {},
            },
          })}
        />,
      );
    });
    expect(host.querySelector('[data-testid="lm-pane-detach-grip-middle"]')).toBeNull();
  });
});
