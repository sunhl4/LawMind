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
import { confirmDialog } from "./lawmind-confirm-dialog";
import {
  applyPostApproveRenderResult,
  createPostApproveExport,
  markPostApproveError,
  markPostApproveExporting,
  persistPostApproveExport,
  type PostApproveExportState,
} from "./lawmind-post-approve-export";
import { readAutoExportOnApprove } from "./lawmind-review-prefs";
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
  expectedReviewStatus?: "pending" | "approved" | "rejected" | "modified";
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
    expectedReviewStatus,
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
      setError("缺少会话，请从对话进入。");
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

  const discardPendingDraft = async () => {
    const taskId = current?.taskId?.trim();
    if (!taskId || current?.kind !== "pending_review") {
      setError("当前没有可丢弃的待签批草稿。");
      return;
    }
    if (
      !(await confirmDialog({
        title: `丢弃待签批草稿「${current.title?.trim() || taskId}」？`,
        body: "将从文书台与在办移除，且不可恢复。已签批或已导出的草稿不会出现在此列表。",
        confirmLabel: "丢弃",
        tone: "danger",
      }))
    ) {
      return;
    }
    const doneId = current.id;
    setBusy(true);
    setError(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; error?: string; message?: string }, undefined>(
        apiBase,
        `/api/drafts/${encodeURIComponent(taskId)}`,
        "DELETE",
      );
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, j.message || "丢弃失败"));
      }
      await refresh();
      advanceAfter(doneId);
    } catch (e) {
      setError(errorMessage(e, "丢弃失败"));
    } finally {
      setBusy(false);
    }
  };

  const submitDraftReview = async (status: "approved" | "rejected" | "modified") => {
    const taskId = current?.taskId?.trim();
    if (!taskId) {
      setError("缺少草稿任务。");
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
        ...(expectedReviewStatus ? { expectedReviewStatus } : {}),
        ...(status === "approved" ? { checklistChecked: deskChecklistChecked } : {}),
      });
      if (!j.ok) {
        const code = typeof j.error === "string" ? j.error : "";
        if (code === "checklist_incomplete") {
          setError("律师必核未齐：请勾选下方必核项，或点「一键勾选必核」后再通过。");
          return;
        }
        if (code === "review_status_conflict") {
          setError("草稿签批状态已变化，请刷新后再试。");
          return;
        }
        throw new Error(messageFromOkFalseBody(j, "签批失败"));
      }
      await refresh();
      if (status === "approved") {
        const stampFailed = j.matterWriteFailed === true;
        const exportState = createPostApproveExport({
          taskId,
          matterId: current?.matterId,
          title: current?.title,
          matterWriteFailed: stampFailed,
        });
        if (stampFailed) {
          const failed = markPostApproveError(exportState, "签批已记，案件戳未写入，请重试导出");
          setPostApproveExport(failed);
          persistPostApproveExport(failed);
        } else {
          setPostApproveExport(exportState);
          persistPostApproveExport(exportState);
          if (readAutoExportOnApprove()) {
            setPostApproveExport(markPostApproveExporting(exportState));
            try {
              const rendered = await apiSendJson<
                { ok?: boolean; error?: string; message?: string; outputPath?: string },
                Record<string, never>
              >(apiBase, `/api/drafts/${encodeURIComponent(taskId)}/render`, "POST", {});
              if (!rendered.ok) {
                throw new Error(messageFromOkFalseBody(rendered, rendered.message || "导出失败"));
              }
              const next = applyPostApproveRenderResult(
                exportState,
                true,
                rendered.outputPath,
              );
              setPostApproveExport(next);
              persistPostApproveExport(next);
              const out = next.outputPath?.trim() ?? "";
              if (next.status === "ok" && out && onShowArtifact) {
                onShowArtifact(out);
              } else if (next.status === "ok" && out && typeof window !== "undefined") {
                void window.lawmindDesktop?.showItemInFolder?.(out);
              }
            } catch (e) {
              const failed = markPostApproveError(exportState, errorMessage(e, "导出失败"));
              setPostApproveExport(failed);
              persistPostApproveExport(failed);
            }
          }
        }
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
      setPostApproveExport((s) => {
        if (!s) {
          return s;
        }
        const next = applyPostApproveRenderResult(s, true, j.outputPath);
        persistPostApproveExport(next);
        return next;
      });
      const out = j.outputPath?.trim() ?? "";
      if (out && onShowArtifact) {
        onShowArtifact(out);
      } else if (out && typeof window !== "undefined") {
        void window.lawmindDesktop?.showItemInFolder?.(out);
      }
    } catch (e) {
      setPostApproveExport((s) => {
        if (!s) {
          return s;
        }
        const next = markPostApproveError(s, errorMessage(e, "导出失败"));
        persistPostApproveExport(next);
        return next;
      });
    }
  };

  const runPostApproveTrackedExport = async (): Promise<{ ok: boolean; message?: string }> => {
    const taskId = postApproveExport?.taskId?.trim();
    if (!apiBase || !taskId) {
      return { ok: false, message: "缺少草稿任务" };
    }
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          error?: string;
          message?: string;
          outputPath?: string;
          code?: string;
        },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(taskId)}/render-tracked`, "POST", {});
      if (!j.ok) {
        if (j.code === "baseline_missing") {
          return {
            ok: false,
            message: "暂无原合同基线，无法出审阅稿；可先在文书台核对基线后再导出。",
          };
        }
        return { ok: false, message: messageFromOkFalseBody(j, j.message || "导出审阅稿失败") };
      }
      const out = j.outputPath?.trim() ?? "";
      if (out && onShowArtifact) {
        onShowArtifact(out);
      } else if (out && typeof window !== "undefined") {
        void window.lawmindDesktop?.showItemInFolder?.(out);
      }
      return { ok: true, message: out ? `已生成审阅稿：${out}` : "已生成审阅稿" };
    } catch (e) {
      return { ok: false, message: errorMessage(e, "导出审阅稿失败") };
    }
  };

  const saveAsAutomation = async (): Promise<{ ok: boolean; message: string }> => {
    const taskId = postApproveExport?.taskId?.trim();
    const matterId = postApproveExport?.matterId?.trim() || current?.matterId?.trim();
    if (!apiBase || !taskId) {
      return { ok: false, message: "缺少已办事项，无法存成自动办件。" };
    }
    if (!matterId) {
      return { ok: false, message: "先指定案件，才能存成自动办件。" };
    }
    try {
      const j = await apiSendJson<
        { ok?: boolean; error?: string; message?: string; automation?: { title?: string } },
        { taskId: string; matterId: string; title?: string }
      >(apiBase, "/api/works/automation", "POST", {
        taskId,
        matterId,
        title: postApproveExport?.title,
      });
      if (!j.ok) {
        return { ok: false, message: messageFromOkFalseBody(j, j.message || "无法存成自动办件") };
      }
      return { ok: true, message: `已存成自动办件${j.automation?.title ? `「${j.automation.title}」` : ""}。关掉 LawMind 后仍会在这台电脑上继续跑。` };
    } catch (e) {
      return { ok: false, message: errorMessage(e, "无法存成自动办件") };
    }
  };

  return {
    approveTool,
    approveToolEdit,
    rejectTool,
    respondClarify,
    resolveMatter,
    submitDraftReview,
    discardPendingDraft,
    runPostApproveExport,
    runPostApproveTrackedExport,
    saveAsAutomation,
  };
}
