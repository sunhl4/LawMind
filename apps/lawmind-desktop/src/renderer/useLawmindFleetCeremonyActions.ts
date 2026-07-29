/**
 * 在办办理区：批准 / 澄清 / 签批 / 导出动作（从 LawmindAgentFleetPanel 抽出）。
 */
import type { Dispatch, SetStateAction } from "react";
import {
  resumeChatAction,
  resolveMatterApproval,
  buildClarificationAnswerMap,
  type LawMindRequiresAction,
} from "./lawmind-requires-action";
import { apiSendJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import { apiPostDraftReview } from "./lawmind-api-routes";
import {
  createPostApproveExport,
  markPostApproveError,
  markPostApproveExporting,
  markPostApproveOk,
  type PostApproveExportState,
} from "./lawmind-post-approve-export";
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";

export function resumeSessionId(
  action: LawMindRequiresAction,
  selected: AgentRunSummary | null,
  activeSessionId?: string,
): string | undefined {
  return action.sessionId?.trim() || selected?.sessionId?.trim() || activeSessionId?.trim() || undefined;
}

export type FleetCeremonyActionsDeps = {
  apiBase: string;
  sessionId?: string;
  current: AgentRunSummary | null;
  clarificationDraft: Record<string, string>;
  deskChecklistChecked: Record<string, boolean>;
  deskChecklistComplete: boolean;
  postApproveExport: PostApproveExportState | null;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
  setClarificationDraft: Dispatch<SetStateAction<Record<string, string>>>;
  setArgsEditOpen: (open: boolean) => void;
  setArgsEditError: (err: string | null) => void;
  setPostApproveExport: Dispatch<SetStateAction<PostApproveExportState | null>>;
  refresh: () => Promise<void>;
  advanceAfter: (doneId?: string) => void;
  onChatResumeComplete?: () => void | Promise<void>;
  onOpenReview?: (taskId?: string, matterId?: string) => void;
  onShowArtifact?: (outputPath: string) => void;
};

export function createFleetCeremonyActions(deps: FleetCeremonyActionsDeps) {
  const {
    apiBase,
    sessionId,
    current,
    clarificationDraft,
    deskChecklistChecked,
    deskChecklistComplete,
    postApproveExport,
    setBusy,
    setError,
    setClarificationDraft,
    setArgsEditOpen,
    setArgsEditError,
    setPostApproveExport,
    refresh,
    advanceAfter,
    onChatResumeComplete,
    onOpenReview,
    onShowArtifact,
  } = deps;

  const approveTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("请先打开对应对话。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "approve" });
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const approveToolEdit = async (
    action: LawMindRequiresAction,
    editedArgs: Record<string, unknown>,
  ) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("请先打开对应对话。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId: sid,
        actionId: action.id,
        decision: "edit",
        editedArgs,
      });
      setArgsEditOpen(false);
      setArgsEditError(null);
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "按修改批准失败"));
    } finally {
      setBusy(false);
    }
  };

  const rejectTool = async (action: LawMindRequiresAction) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, { sessionId: sid, actionId: action.id, decision: "reject" });
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "已驳回"));
    } finally {
      setBusy(false);
    }
  };

  const respondClarify = async (
    action: LawMindRequiresAction,
    answersOverride?: Record<string, string>,
  ) => {
    const sid = resumeSessionId(action, current, sessionId);
    if (!sid) {
      setError("缺少会话，无法提交补充。请从对话进入该任务后再试。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resumeChatAction(apiBase, {
        sessionId: sid,
        actionId: action.id,
        decision: "respond",
        clarificationAnswers: buildClarificationAnswerMap(
          action.clarificationQuestions ?? [],
          answersOverride ?? clarificationDraft,
        ),
      });
      setClarificationDraft({});
      await onChatResumeComplete?.();
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "提交失败"));
    } finally {
      setBusy(false);
    }
  };

  const resolveMatter = async (
    action: LawMindRequiresAction,
    status: "approved" | "rejected",
  ) => {
    if (!action.matterId || !action.approvalId) {
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    try {
      await resolveMatterApproval(apiBase, {
        matterId: action.matterId,
        approvalId: action.approvalId,
        status,
      });
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "处理失败"));
    } finally {
      setBusy(false);
    }
  };

  const submitDraftReview = async (status: "approved" | "rejected" | "modified") => {
    const taskId = current?.taskId?.trim();
    if (!taskId) {
      setError("缺少草稿任务，请先打开文书台。");
      return;
    }
    if (status === "approved" && !deskChecklistComplete) {
      setError("律师必核未齐：请勾选下方必核项，或点「一键勾选必核」后再通过。");
      return;
    }
    const doneId = current?.id;
    setBusy(true);
    setError(null);
    try {
      const j = await apiPostDraftReview(apiBase, taskId, {
        status,
        ...(status === "approved" ? { checklistChecked: deskChecklistChecked } : {}),
      });
      if (!j.ok) {
        const code = typeof j.error === "string" ? j.error : "";
        if (code === "checklist_incomplete") {
          setError("律师必核未齐：请勾选下方必核项，或点「一键勾选必核」后再通过。");
          return;
        }
        throw new Error(messageFromOkFalseBody(j, "签批失败"));
      }
      await refresh();
      if (status === "approved") {
        setPostApproveExport(
          createPostApproveExport({
            taskId,
            matterId: current?.matterId,
            title: current?.title,
          }),
        );
      }
      advanceAfter(doneId);
      if (status === "modified" && onOpenReview) {
        onOpenReview(taskId, current?.matterId);
      }
    } catch (e) {
      setError(errorMessage(e, "签批失败"));
    } finally {
      setBusy(false);
    }
  };

  const runPostApproveExport = async () => {
    if (!apiBase || !postApproveExport?.taskId) {
      return;
    }
    setPostApproveExport((s) => (s ? markPostApproveExporting(s) : s));
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; message?: string; outputPath?: string },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(postApproveExport.taskId)}/render`, "POST", {});
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, j.message || "导出失败"));
      }
      const out = j.outputPath?.trim() ?? "";
      setPostApproveExport((s) => (s ? markPostApproveOk(s, out) : s));
      if (out && onShowArtifact) {
        onShowArtifact(out);
      } else if (out && typeof window !== "undefined") {
        void window.lawmindDesktop?.showItemInFolder?.(out);
      }
    } catch (e) {
      setPostApproveExport((s) =>
        s ? markPostApproveError(s, errorMessage(e, "导出失败")) : s,
      );
    }
  };

  return {
    approveTool,
    approveToolEdit,
    rejectTool,
    respondClarify,
    resolveMatter,
    submitDraftReview,
    runPostApproveExport,
  };
}
