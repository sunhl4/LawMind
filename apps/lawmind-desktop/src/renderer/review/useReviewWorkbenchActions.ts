import { useCallback, useState, type MutableRefObject } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { AcceptanceReport } from "../../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";
import {
  apiSendJson,
  errorMessage,
  messageFromOkFalseBody,
  userMessageFromApiError,
  type ApiErrorJson,
} from "../api-client";
import { readAutoExportOnApprove } from "../lawmind-review-prefs";
import {
  officecliMissingErrorMessage,
  officecliPlainFallbackNote,
  parseFilenameFromContentDisposition,
  triggerBrowserDownload,
} from "./review-workbench-helpers";

type ReviewSubmitBody = {
  status: "approved" | "rejected" | "modified";
  note?: string;
  appendToProfile: boolean;
  appendToLawyerProfile: boolean;
  profileAssistantId: string;
  labels?: string[];
  deferMemoryWrites?: true;
};

export type UseReviewWorkbenchActionsParams = {
  apiBase: string;
  assistantId: string;
  selectedTaskId: string | null;
  detail: ArtifactDraft | null;
  acceptance: AcceptanceReport | null;
  note: string;
  setNote: (value: string) => void;
  selectedLabels: Set<string>;
  setSelectedLabels: (labels: Set<string>) => void;
  deferMemoryWrites: boolean;
  setDeferMemoryWrites: (value: boolean) => void;
  appendToProfile: boolean;
  appendToLawyerProfile: boolean;
  renderTemplateId: string;
  revisionDispatchNote: string;
  revisionPrefilledForTaskRef: MutableRefObject<string | null>;
  setRevisionDispatchNote: (value: string) => void;
  setActionMsg: (msg: string | null) => void;
  setLastExportPath: (path: string | null) => void;
  applyDetailFromResponse: (
    taskId: string,
    j: {
      draft?: ArtifactDraft;
      citationIntegrity?: DraftCitationIntegrityView;
      acceptance?: AcceptanceReport;
      executionState?: TaskExecutionState;
      gateDecisions?: GateDecision[];
    },
  ) => void;
  loadDrafts: (opts?: { silent?: boolean }) => Promise<void>;
  loadDetail: (taskId: string, opts?: { preserveContent?: boolean }) => Promise<void>;
  loadLearningQueue: () => Promise<void>;
  onRecordsChanged?: () => void;
  onShowArtifact?: (outputPath: string) => void;
  onRevisionJobQueued?: (opts: { sessionId: string; assistantId: string; taskId: string }) => void;
  syncEditorFromDraft: (draft: ArtifactDraft) => void;
  clearEditorSaveError: () => void;
};

export function useReviewWorkbenchActions(params: UseReviewWorkbenchActionsParams) {
  const {
    apiBase,
    assistantId,
    selectedTaskId,
    detail,
    acceptance,
    note,
    setNote,
    selectedLabels,
    setSelectedLabels,
    deferMemoryWrites,
    setDeferMemoryWrites,
    appendToProfile,
    appendToLawyerProfile,
    renderTemplateId,
    revisionDispatchNote,
    revisionPrefilledForTaskRef,
    setRevisionDispatchNote,
    setActionMsg,
    setLastExportPath,
    applyDetailFromResponse,
    loadDrafts,
    loadDetail,
    loadLearningQueue,
    onRecordsChanged,
    onShowArtifact,
    onRevisionJobQueued,
    syncEditorFromDraft,
    clearEditorSaveError,
  } = params;

  const [actionBusy, setActionBusy] = useState(false);
  const [revisionDispatchBusy, setRevisionDispatchBusy] = useState(false);
  const [packBusy, setPackBusy] = useState(false);

  const submitRender = useCallback(
    async (opts?: { strict?: boolean }) => {
      if (!selectedTaskId) {
        return;
      }
      setActionBusy(true);
      setActionMsg(null);
      try {
        const renderBody: { templateId?: string } = {};
        if (renderTemplateId.trim()) {
          renderBody.templateId = renderTemplateId.trim();
        }
        const strictQs = opts?.strict === false ? "?strict=false" : "";
        const j = await apiSendJson<
          {
            ok?: boolean;
            error?: string;
            message?: string;
            outputPath?: string;
            acceptance?: AcceptanceReport;
            executionState?: TaskExecutionState;
            gateDecisions?: GateDecision[];
          },
          { templateId?: string }
        >(
          apiBase,
          `/api/drafts/${encodeURIComponent(selectedTaskId)}/render${strictQs}`,
          "POST",
          renderBody,
        );
        if (!j.ok) {
          if (j.acceptance) {
            applyDetailFromResponse(selectedTaskId, { acceptance: j.acceptance });
          }
          throw new Error(messageFromOkFalseBody(j, "渲染失败"));
        }
        applyDetailFromResponse(selectedTaskId, j);
        const out = j.outputPath?.trim() ?? "";
        setLastExportPath(out || null);
        setActionMsg(out ? `已生成 Word：${out}` : "已生成交付物");
        await loadDrafts();
        if (j.outputPath && onShowArtifact) {
          onShowArtifact(j.outputPath);
        }
        onRecordsChanged?.();
      } catch (e) {
        setActionMsg(errorMessage(e, "渲染失败"));
      } finally {
        setActionBusy(false);
      }
    },
    [
      apiBase,
      applyDetailFromResponse,
      loadDrafts,
      onRecordsChanged,
      onShowArtifact,
      renderTemplateId,
      selectedTaskId,
      setActionMsg,
      setLastExportPath,
    ],
  );

  const submitReopenReview = useCallback(async () => {
    if (!selectedTaskId) {
      return;
    }
    if (!apiBase?.trim()) {
      setActionMsg("未配置本地服务地址，无法操作。请确认已打开工作区并连接本机 LawMind 服务。");
      return;
    }
    setActionBusy(true);
    setActionMsg("正在向本机提交「恢复待审核」…");
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          error?: string;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
          acceptance?: AcceptanceReport;
          executionState?: TaskExecutionState;
          gateDecisions?: GateDecision[];
        },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/reopen-review`, "POST", {});
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "恢复待审核失败"));
      }
      setActionMsg("已恢复为待审核。可再次使用通过 / 驳回 / 需修改；通过后可用「渲染交付物」。");
      revisionPrefilledForTaskRef.current = null;
      setRevisionDispatchNote("");
      await loadDrafts();
      if (j.draft) {
        applyDetailFromResponse(selectedTaskId, j);
        syncEditorFromDraft(j.draft);
        clearEditorSaveError();
      } else {
        void loadDetail(selectedTaskId);
      }
      onRecordsChanged?.();
    } catch (e) {
      const err = errorMessage(e, "恢复待审核失败");
      setActionMsg(`${err} 若一直失败，请确认本应用与本地服务为同一版本并已重启。`);
    } finally {
      setActionBusy(false);
    }
  }, [
    apiBase,
    applyDetailFromResponse,
    clearEditorSaveError,
    loadDetail,
    loadDrafts,
    onRecordsChanged,
    revisionPrefilledForTaskRef,
    selectedTaskId,
    setActionMsg,
    setRevisionDispatchNote,
    syncEditorFromDraft,
  ]);

  const submitReview = useCallback(
    async (status: "approved" | "rejected" | "modified") => {
      if (!selectedTaskId) {
        return;
      }
      setActionBusy(true);
      setActionMsg(null);
      try {
        const labels = Array.from(selectedLabels);
        const j = await apiSendJson<
          {
            ok?: boolean;
            error?: string;
            draft?: ArtifactDraft;
            citationIntegrity?: DraftCitationIntegrityView;
            profileAppendFailed?: boolean;
            lawyerProfileAppendFailed?: boolean;
            profileLearningSkipped?: boolean;
            lawyerProfileLearningSkipped?: boolean;
            executionState?: TaskExecutionState;
            gateDecisions?: GateDecision[];
          },
          ReviewSubmitBody
        >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/review`, "POST", {
          status,
          note: note.trim() || undefined,
          appendToProfile: deferMemoryWrites ? false : appendToProfile,
          appendToLawyerProfile: deferMemoryWrites ? false : appendToLawyerProfile,
          profileAssistantId: assistantId,
          ...(labels.length > 0 ? { labels } : {}),
          ...(deferMemoryWrites ? { deferMemoryWrites: true } : {}),
        });
        if (!j.ok) {
          const extra = j.lawyerProfileAppendFailed
            ? "（律师档案未写入，草稿状态已保存）"
            : j.profileAppendFailed
              ? "（助手档案未写入，草稿状态已保存）"
              : "";
          throw new Error(messageFromOkFalseBody(j, "审核失败") + extra);
        }
        setNote("");
        setSelectedLabels(new Set());
        setDeferMemoryWrites(false);
        let msg: string;
        if (status === "approved") {
          msg = "已通过签批。可点击下方「导出 Word」生成本地文件。";
        } else if (status === "modified") {
          msg =
            "已保存为「需修改」及签批备注。请在下方「发给助手的补充说明」中完善意见后，点击「提交给助手（后台执行）」派发修订；未点击则不会启动后台改稿。";
        } else {
          msg = "已记录驳回。助手不会自动处理：请在主对话中说明后续如何办理或是否重做。";
        }
        if (j.profileLearningSkipped || j.lawyerProfileLearningSkipped) {
          msg += " 助手/律师档案中已有该任务对应的学习记录，本次未重复写入。";
        }
        setActionMsg(msg);
        await loadDrafts();
        void loadLearningQueue();
        if (j.draft) {
          applyDetailFromResponse(selectedTaskId, j);
        }
        onRecordsChanged?.();
        if (status === "approved" && readAutoExportOnApprove()) {
          const acc = acceptance;
          const gateBlocked = acc?.deliverableType != null && acc && !acc.ready;
          if (gateBlocked) {
            const ok = window.confirm(
              `已开启「通过后自动导出 Word」，但出稿检查仍有 ${acc?.blockerCount ?? 0} 项阻塞。\n\n仍要导出？`,
            );
            if (ok) {
              await submitRender({ strict: false });
            }
          } else {
            await submitRender({ strict: true });
          }
        }
      } catch (e) {
        setActionMsg(errorMessage(e, "审核失败"));
      } finally {
        setActionBusy(false);
      }
    },
    [
      acceptance,
      apiBase,
      appendToLawyerProfile,
      appendToProfile,
      applyDetailFromResponse,
      assistantId,
      deferMemoryWrites,
      loadDrafts,
      loadLearningQueue,
      note,
      onRecordsChanged,
      selectedLabels,
      selectedTaskId,
      setActionMsg,
      setDeferMemoryWrites,
      setNote,
      setSelectedLabels,
      submitRender,
    ],
  );

  const adoptSuggestion = useCallback(
    async (id: string, setLearningBusy: (id: string | null) => void) => {
      setLearningBusy(id);
      try {
        const j = await apiSendJson<{ ok?: boolean; error?: string }, Record<string, never>>(
          apiBase,
          `/api/learning/suggestions/${encodeURIComponent(id)}/adopt`,
          "POST",
          {},
        );
        if (!j.ok) {
          throw new Error(messageFromOkFalseBody(j, "采纳失败"));
        }
        await loadLearningQueue();
      } catch (e) {
        setActionMsg(errorMessage(e, "采纳失败"));
      } finally {
        setLearningBusy(null);
      }
    },
    [apiBase, loadLearningQueue, setActionMsg],
  );

  const dismissSuggestion = useCallback(
    async (id: string, setLearningBusy: (id: string | null) => void) => {
      setLearningBusy(id);
      try {
        const j = await apiSendJson<{ ok?: boolean; error?: string }, Record<string, never>>(
          apiBase,
          `/api/learning/suggestions/${encodeURIComponent(id)}/dismiss`,
          "POST",
          {},
        );
        if (!j.ok) {
          throw new Error(messageFromOkFalseBody(j, "忽略失败"));
        }
        await loadLearningQueue();
      } catch (e) {
        setActionMsg(errorMessage(e, "忽略失败"));
      } finally {
        setLearningBusy(null);
      }
    },
    [apiBase, loadLearningQueue, setActionMsg],
  );

  const submitRevisionJob = useCallback(async () => {
    if (!selectedTaskId?.trim()) {
      return;
    }
    if ((detail?.reviewStatus ?? "pending") !== "modified") {
      return;
    }
    setRevisionDispatchBusy(true);
    setActionMsg(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          queued?: boolean;
          sessionId?: string;
          assistantId?: string;
          error?: string;
          message?: string;
        },
        { instruction?: string; assistantId?: string }
      >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/revision-job`, "POST", {
        instruction: revisionDispatchNote.trim() || undefined,
        assistantId,
      });
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "提交失败"));
      }
      const queuedSessionId = typeof j.sessionId === "string" ? j.sessionId.trim() : "";
      const queuedAssistantId =
        typeof j.assistantId === "string" && j.assistantId.trim()
          ? j.assistantId.trim()
          : assistantId;
      if (queuedSessionId && onRevisionJobQueued) {
        onRevisionJobQueued({
          sessionId: queuedSessionId,
          assistantId: queuedAssistantId,
          taskId: selectedTaskId,
        });
        setActionMsg("已提交后台修订，正在工作区对话中展示执行过程；完成后将自动回到审核台并恢复为待审核。");
      } else {
        setActionMsg(
          "已提交后台修订：请到工作区切换到当前助手，在会话列表中打开最新「审核修订」会话查看进度；完成后回到本页刷新。",
        );
      }
    } catch (e) {
      setActionMsg(errorMessage(e, "提交后台修订失败"));
    } finally {
      setRevisionDispatchBusy(false);
    }
  }, [
    apiBase,
    assistantId,
    detail?.reviewStatus,
    onRevisionJobQueued,
    revisionDispatchNote,
    selectedTaskId,
    setActionMsg,
  ]);

  const submitRenderTracked = useCallback(async () => {
    if (!selectedTaskId) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          error?: string;
          message?: string;
          outputPath?: string;
          mode?: string;
          code?: string;
        },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/render-tracked`, "POST", {});
      if (!j.ok) {
        throw new Error(
          officecliMissingErrorMessage(j, messageFromOkFalseBody(j, "导出带修订 Word 失败")),
        );
      }
      const out = j.outputPath?.trim() ?? "";
      setLastExportPath(out || null);
      const modeNote = officecliPlainFallbackNote(j.mode);
      setActionMsg(out ? `已生成带修订 Word：${out}${modeNote}` : `已生成交付物${modeNote}`);
      await loadDrafts();
      if (j.outputPath && onShowArtifact) {
        onShowArtifact(j.outputPath);
      }
      onRecordsChanged?.();
    } catch (e) {
      setActionMsg(errorMessage(e, "导出带修订 Word 失败"));
    } finally {
      setActionBusy(false);
    }
  }, [apiBase, loadDrafts, onRecordsChanged, onShowArtifact, selectedTaskId, setActionMsg, setLastExportPath]);

  const downloadAcceptancePack = useCallback(async () => {
    if (!selectedTaskId || !detail) {
      return;
    }
    setPackBusy(true);
    setActionMsg(null);
    try {
      const url = `${apiBase}/api/drafts/${encodeURIComponent(selectedTaskId)}/acceptance-pack`;
      const resp = await fetch(url, { headers: { accept: "text/markdown" } });
      if (!resp.ok) {
        const text = await resp.text();
        let body: ApiErrorJson = {};
        try {
          body = text.trim() ? (JSON.parse(text) as ApiErrorJson) : {};
        } catch {
          body = {};
        }
        let msg = userMessageFromApiError(resp.status, body);
        if (msg === `请求失败（HTTP ${resp.status}）` && text.trim()) {
          const snippet = text.slice(0, 220).replace(/\s+/g, " ").trim();
          if (snippet) {
            msg = `${msg}：${snippet}`;
          }
        }
        throw new Error(msg);
      }
      const blob = await resp.blob();
      const filename =
        parseFilenameFromContentDisposition(resp.headers.get("content-disposition")) ??
        `acceptance-pack-${selectedTaskId}.md`;
      triggerBrowserDownload(blob, filename);
      setActionMsg(`已下载验收交付包：${filename}`);
    } catch (e) {
      setActionMsg(errorMessage(e, "下载验收交付包失败"));
    } finally {
      setPackBusy(false);
    }
  }, [apiBase, detail, selectedTaskId, setActionMsg]);

  return {
    actionBusy,
    revisionDispatchBusy,
    packBusy,
    submitReopenReview,
    submitReview,
    submitRender,
    submitRenderTracked,
    submitRevisionJob,
    downloadAcceptancePack,
    adoptSuggestion,
    dismissSuggestion,
  };
}
