import { useCallback, type Dispatch, type SetStateAction } from "react";
import { createAssistantDraft, deleteAssistant, saveAssistantDraft, type AssistantEditorDraft } from "./lawmind-assistant-editor";
import { removeAssistantChatState, type ChatMsg } from "./lawmind-chat";
import { clearStoredActiveChatSessionForAssistant } from "./useLawmindChatShell";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import type { AppConfig } from "./lawmind-app-bootstrap";
import { errorMessage } from "./api-client";

export type UseLawmindAssistantActionsParams = {
  config: AppConfig | null;
  selectedAssistantId: string;
  setSelectedAssistantId: (id: string) => void;
  assistants: Array<{ assistantId: string; displayName: string; introduction: string; createdAt: string; updatedAt: string }>;
  presets: Parameters<typeof createAssistantDraft>[1];
  editingAssistantId: string | null;
  assistantDraft: AssistantEditorDraft;
  setEditingAssistantId: (id: string | null) => void;
  setAssistantDraft: (draft: AssistantEditorDraft) => void;
  setShowAssistantEditor: (open: boolean) => void;
  setAsstBusy: (busy: boolean) => void;
  setAsstError: (error: string | null) => void;
  setError: (message: string | null) => void;
  setSessionByAssistant: Dispatch<SetStateAction<Record<string, string | undefined>>>;
  setMessagesByAssistant: Dispatch<SetStateAction<Record<string, ChatMsg[]>>>;
  refreshAssistants: () => Promise<void>;
};

export function useLawmindAssistantActions(params: UseLawmindAssistantActionsParams) {
  const {
    config,
    selectedAssistantId,
    setSelectedAssistantId,
    assistants,
    presets,
    editingAssistantId,
    assistantDraft,
    setEditingAssistantId,
    setAssistantDraft,
    setShowAssistantEditor,
    setAsstBusy,
    setAsstError,
    setError,
    setSessionByAssistant,
    setMessagesByAssistant,
    refreshAssistants,
  } = params;

  const openNewAssistant = useCallback(() => {
    setEditingAssistantId(null);
    setAssistantDraft(createAssistantDraft("create", presets));
    setAsstError(null);
    setShowAssistantEditor(true);
  }, [presets, setAssistantDraft, setAsstError, setEditingAssistantId, setShowAssistantEditor]);

  const openEditAssistant = useCallback(() => {
    const assistant = assistants.find((entry) => entry.assistantId === selectedAssistantId);
    if (!assistant) {
      return;
    }
    setEditingAssistantId(assistant.assistantId);
    setAssistantDraft(createAssistantDraft("edit", presets, assistant));
    setAsstError(null);
    setShowAssistantEditor(true);
  }, [assistants, presets, selectedAssistantId, setAssistantDraft, setAsstError, setEditingAssistantId, setShowAssistantEditor]);

  const saveAssistant = useCallback(async () => {
    if (!config) {
      return;
    }
    setAsstBusy(true);
    setAsstError(null);
    try {
      const result = await saveAssistantDraft({
        apiBase: config.apiBase,
        editingAssistantId,
        draft: assistantDraft,
      });
      if (result.assistant?.assistantId) {
        setSelectedAssistantId(result.assistant.assistantId);
      }
      setShowAssistantEditor(false);
      await refreshAssistants();
    } catch (cause) {
      setAsstError(errorMessage(cause, "保存助手失败"));
    } finally {
      setAsstBusy(false);
    }
  }, [
    assistantDraft,
    config,
    editingAssistantId,
    refreshAssistants,
    setAsstBusy,
    setAsstError,
    setSelectedAssistantId,
    setShowAssistantEditor,
  ]);

  const removeAssistant = useCallback(async () => {
    if (!config || selectedAssistantId === DEFAULT_ASSISTANT_ID) {
      return;
    }
    if (!window.confirm("确定删除该助手？其会话记录仍保留在工作区。")) {
      return;
    }
    try {
      if (!config.workspaceDir.trim().startsWith("(")) {
        clearStoredActiveChatSessionForAssistant(config.workspaceDir, selectedAssistantId);
      }
      await deleteAssistant(config.apiBase, selectedAssistantId);
      setSessionByAssistant((previous) => removeAssistantChatState(previous, selectedAssistantId));
      setMessagesByAssistant((previous) => removeAssistantChatState(previous, selectedAssistantId));
      setSelectedAssistantId(DEFAULT_ASSISTANT_ID);
      await refreshAssistants();
    } catch (cause) {
      setError(errorMessage(cause, "删除助手失败"));
    }
  }, [
    config,
    refreshAssistants,
    selectedAssistantId,
    setError,
    setMessagesByAssistant,
    setSelectedAssistantId,
    setSessionByAssistant,
  ]);

  return {
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
  };
}
