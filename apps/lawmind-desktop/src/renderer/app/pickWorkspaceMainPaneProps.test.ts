import { describe, expect, it, vi } from "vitest";
import type { LawmindMainBodyContentProps } from "./LawmindMainBodyContent";
import { pickWorkspaceMainPaneProps } from "./pickWorkspaceMainPaneProps";

function baseProps(
  overrides: Partial<LawmindMainBodyContentProps> = {},
): LawmindMainBodyContentProps {
  return {
    canUseFilesystemBridge: false,
    setFileEditorHost: () => {},
    wsShowEditor: true,
    onShowEditorPane: () => {},
    wsShowChat: true,
    onShowChatPane: () => {},
    onWsChatSplitResize: () => {},
    wsChatColWidth: 360,
    chatSessionList: [],
    chatSessionsLoading: false,
    loading: false,
    onSelectChatSession: async () => {},
    onCreateNewChatSession: async () => {},
    onRenameChatSession: async () => {},
    onDeleteChatSession: async () => {},
    config: { apiBase: "http://127.0.0.1:9" } as LawmindMainBodyContentProps["config"],
    currentMessages: [],
    copiedMessageIndex: null,
    messagesEndRef: { current: null },
    onCopyMessage: () => {},
    onInputChange: () => {},
    textareaRef: { current: null },
    onSendClarificationMessage: async () => {},
    streamCompactLabels: false,
    fileChatContextItems: [],
    onAddFileToChatContext: () => {},
    onRemoveFileChatPill: () => {},
    onClearFileChatPills: () => {},
    onCreateMatter: () => {},
    showEmptyMatterGuide: true,
    ...overrides,
  } as LawmindMainBodyContentProps;
}

describe("pickWorkspaceMainPaneProps", () => {
  it("passes create-matter and empty-guide flags through", () => {
    const onCreateMatter = vi.fn();
    const props = pickWorkspaceMainPaneProps(
      baseProps({ onCreateMatter, showEmptyMatterGuide: true }),
    );
    expect(props.onCreateMatter).toBe(onCreateMatter);
    expect(props.showEmptyMatterGuide).toBe(true);
  });

  it("falls back onOpenAgentsWorkflows to workflow library", () => {
    const onOpenWorkflowLibrary = vi.fn();
    const props = pickWorkspaceMainPaneProps(
      baseProps({
        onOpenAgentsWorkflows: undefined,
        onOpenWorkflowLibrary,
      }),
    );
    props.onOpenAgentsWorkflows?.();
    expect(onOpenWorkflowLibrary).toHaveBeenCalledOnce();
  });
});
