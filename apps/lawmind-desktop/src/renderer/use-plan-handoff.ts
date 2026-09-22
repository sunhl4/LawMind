import { useCallback, useEffect, useState } from "react";
import type { ComposePermissionMode } from "./lawmind-compose-prefs";
import { readComposePermissionMode, readExecutePermissionMode } from "./lawmind-compose-prefs";
import type { ChatMsg } from "./lawmind-chat";
import {
  buildExecuteConfirmPrompt,
  clearPlanHandoff,
  deleteSessionPlanHandoff,
  isExecuteConfirmPrompt,
  pushSessionPlanHandoff,
  readPlanHandoff,
  reconcilePlanHandoffWithServer,
  resolvePlanHandoffForExecute,
  resolveStartExecutePrompt,
  syncPlanHandoffFromMessages,
  writePlanHandoff,
} from "./lawmind-plan-handoff";

export function usePlanHandoffControls(opts: {
  apiBase?: string;
  chatSessionId?: string;
  currentMessages: ChatMsg[];
  permissionMode?: ComposePermissionMode;
  input: string;
  onInputChange: (text: string) => void;
  onDispatchJob?: (prompt: string) => void | Promise<void>;
  onPermissionModeChange: (mode: ComposePermissionMode) => void;
}) {
  const {
    apiBase,
    chatSessionId,
    currentMessages,
    permissionMode,
    input,
    onInputChange,
    onDispatchJob,
    onPermissionModeChange,
  } = opts;
  const [planHandoffText, setPlanHandoffText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const merged = await reconcilePlanHandoffWithServer(apiBase, chatSessionId);
      if (!cancelled) {
        setPlanHandoffText(merged?.planText ?? readPlanHandoff(chatSessionId)?.planText ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, chatSessionId]);

  useEffect(() => {
    if (!chatSessionId) {
      return;
    }
    const mode = permissionMode || readComposePermissionMode();
    if (mode !== "readonly") {
      return;
    }
    const synced = syncPlanHandoffFromMessages(chatSessionId, currentMessages);
    if (synced?.planText) {
      setPlanHandoffText(synced.planText);
      if (apiBase) {
        void pushSessionPlanHandoff(apiBase, chatSessionId, synced.planText, synced.updatedAt);
      }
    }
  }, [apiBase, chatSessionId, currentMessages, permissionMode]);

  const persistPlanLocalAndRemote = useCallback(
    (plan: string) => {
      if (!plan.trim()) {
        return;
      }
      writePlanHandoff(chatSessionId, plan, undefined, "lawyer");
      setPlanHandoffText(plan);
      if (apiBase && chatSessionId) {
        void pushSessionPlanHandoff(apiBase, chatSessionId, plan);
      }
    },
    [apiBase, chatSessionId],
  );

  const fillPlanHandoff = useCallback(() => {
    onPermissionModeChange(readExecutePermissionMode());
    const plan = resolvePlanHandoffForExecute(chatSessionId, currentMessages, planHandoffText);
    persistPlanLocalAndRemote(plan);
    onInputChange(buildExecuteConfirmPrompt(plan));
  }, [
    chatSessionId,
    currentMessages,
    onInputChange,
    onPermissionModeChange,
    persistPlanLocalAndRemote,
    planHandoffText,
  ]);

  const dismissPlanHandoff = useCallback(() => {
    clearPlanHandoff(chatSessionId);
    setPlanHandoffText(null);
    if (apiBase && chatSessionId) {
      void deleteSessionPlanHandoff(apiBase, chatSessionId);
    }
  }, [apiBase, chatSessionId]);

  const startExecuteFromPlan = useCallback(() => {
    onPermissionModeChange(readExecutePermissionMode());
    const plan = resolvePlanHandoffForExecute(chatSessionId, currentMessages, planHandoffText);
    persistPlanLocalAndRemote(plan);
    const prompt = resolveStartExecutePrompt(input, plan);
    if (!prompt) {
      return;
    }
    if (isExecuteConfirmPrompt(prompt)) {
      clearPlanHandoff(chatSessionId);
      setPlanHandoffText(null);
      if (apiBase && chatSessionId) {
        void deleteSessionPlanHandoff(apiBase, chatSessionId);
      }
    }
    onInputChange("");
    if (onDispatchJob) {
      void onDispatchJob(prompt);
      return;
    }
    onInputChange(prompt);
  }, [
    apiBase,
    chatSessionId,
    currentMessages,
    input,
    onDispatchJob,
    onInputChange,
    onPermissionModeChange,
    persistPlanLocalAndRemote,
    planHandoffText,
  ]);

  return {
    planHandoffText,
    persistPlanLocalAndRemote,
    fillPlanHandoff,
    dismissPlanHandoff,
    startExecuteFromPlan,
  };
}
