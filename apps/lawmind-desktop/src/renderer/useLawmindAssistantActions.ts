import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  createAssistantDraft,
  deleteAssistant,
  saveAssistantDraft,
  type AssistantEditorDraft,
} from "./lawmind-assistant-editor";
import { apiDuplicateAssistant, apiPatchAssistant } from "./lawmind-api-routes";
import { removeAssistantChatState, type ChatMsg } from "./lawmind-chat";
import { clearStoredActiveChatSessionForAssistant } from "./useLawmindChatShell";
import { DEFAULT_ASSISTANT_ID } from "../../../../src/lawmind/assistants/constants.ts";
import type { AppConfig } from "./lawmind-app-bootstrap";
import { errorMessage } from "./api-client";
import { confirmDialog } from "./lawmind-confirm-dialog";

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

  const openNewAssistant = useCallback(
    (presetKey?: string) => {
      setEditingAssistantId(null);
      setAssistantDraft(
        createAssistantDraft("create", presets, undefined, presetKey ? { presetKey } : undefined),
      );
      setAsstError(null);
      setShowAssistantEditor(true);
    },
    [presets, setAssistantDraft, setAsstError, setEditingAssistantId, setShowAssistantEditor],
  );

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

  const saveAssistant = useCallback(
    async (draftOverride?: AssistantEditorDraft) => {
      if (!config) {
        return;
      }
      const draft = draftOverride ?? assistantDraft;
      setAsstBusy(true);
      setAsstError(null);
      try {
        const result = await saveAssistantDraft({
          apiBase: config.apiBase,
          editingAssistantId,
          draft,
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
    },
    [
      assistantDraft,
      config,
      editingAssistantId,
      refreshAssistants,
      setAsstBusy,
      setAsstError,
      setSelectedAssistantId,
      setShowAssistantEditor,
    ],
  );

  const removeAssistant = useCallback(async () => {
    if (!config || selectedAssistantId === DEFAULT_ASSISTANT_ID) {
      return;
    }
    if (
      !(await confirmDialog({
        title: "确定删除该助手？",
        body: "只从名册里去掉这位助手。对话、案件和交付物都还在。",
        confirmLabel: "删除",
        tone: "danger",
      }))
    ) {
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

  /**
   * 复制当前助手：把**角色**（含职务说明书）复制成一个新助手。
   *
   * 不复制记忆与用量——新助手不该继承别人积累的客户事，这条语义由引擎与单测
   * 保证（见 `duplicateAssistant`）；渲染层不提供开关，避免把「要不要连记忆一起抄」
   * 变成一个能被点错的选择。
   *
   * 复制完选中副本：律师的下一步几乎总是给它改名、划新范围。
   */
  const duplicateAssistant = useCallback(async () => {
    if (!config || !selectedAssistantId) {
      return;
    }
    setAsstBusy(true);
    setAsstError(null);
    try {
      const response = await apiDuplicateAssistant(config.apiBase, selectedAssistantId);
      if (!response.ok) {
        throw new Error("duplicate failed");
      }
      const newId = (response.assistant as { assistantId?: string } | undefined)?.assistantId;
      await refreshAssistants();
      if (newId) {
        setSelectedAssistantId(newId);
      }
    } catch (cause) {
      setAsstError(errorMessage(cause, "复制助手失败"));
    } finally {
      setAsstBusy(false);
    }
  }, [
    config,
    refreshAssistants,
    selectedAssistantId,
    setAsstBusy,
    setAsstError,
    setSelectedAssistantId,
  ]);

  const patchAssistantRoster = useCallback(
    async (assistantId: string, patch: { pinned?: boolean; hidden?: boolean }) => {
      if (!config) {
        return;
      }
      setAsstBusy(true);
      setAsstError(null);
      try {
        const response = await apiPatchAssistant(config.apiBase, assistantId, patch);
        if (!response.ok) {
          throw new Error("roster patch failed");
        }
        if (patch.hidden === true && assistantId === selectedAssistantId) {
          setSelectedAssistantId(DEFAULT_ASSISTANT_ID);
        }
        await refreshAssistants();
      } catch (cause) {
        setAsstError(errorMessage(cause, "更新名册失败"));
      } finally {
        setAsstBusy(false);
      }
    },
    [config, refreshAssistants, selectedAssistantId, setAsstBusy, setAsstError, setSelectedAssistantId],
  );

  return {
    openNewAssistant,
    openEditAssistant,
    saveAssistant,
    removeAssistant,
    duplicateAssistant,
    patchAssistantRoster,
  };
}
