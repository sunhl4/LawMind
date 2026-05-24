/**
 * 草稿审核台 — 列表、全文审阅、通过 / 驳回 / 备注、批准后渲染交付物。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";
import { deriveReviewGateDecisions } from "../../../../src/lawmind/platform/review-gates.ts";
import {
  gateDecisionBadgeClass,
  gateDecisionLabel,
} from "./lawmind-gate-display";
import { ALL_REVIEW_LABELS } from "../../../../src/lawmind/review-labels.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { LearningSuggestionRecord } from "../../../../src/lawmind/learning/suggestion-queue.ts";
import { LawmindAcceptanceGate } from "./LawmindAcceptanceGate";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindReviewDeliveryBar } from "./LawmindReviewDeliveryBar";
import { LawmindReviewSelfCheckSummary } from "./LawmindReviewSelfCheckSummary";
import { LawmindDraftDocumentEditor } from "./LawmindDraftDocumentEditor";
import { LawmindDraftDocumentPreview } from "./LawmindDraftDocumentPreview";
import {
  draftDocumentEditorValueFromDraft,
  draftDocumentEditorValuesEqual,
  draftDocumentEditorValueToPatch,
  isDraftDocumentEditable,
  type DraftDocumentEditorValue,
} from "./lawmind-draft-document-editor";
import { readAutoExportOnApprove } from "./lawmind-review-prefs";
import { reviewStatusDisplayLabel } from "./lawmind-review-display";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import {
  apiGetJson,
  apiSendJson,
  errorMessage,
  messageFromOkFalseBody,
  userMessageFromApiError,
  type ApiErrorJson,
} from "./api-client";
import { useEdition } from "./use-edition";
import { LM_PANE_MIN_WIDTH_PX } from "./lawmind-panel-layout";
import {
  hasVisibleReviewPaneAfter,
  lastVisibleReviewPaneId,
  type ReviewPaneId,
  type ReviewPaneVisibility,
} from "./lawmind-review-pane-prefs";
import { LawmindReviewDraftPicker } from "./LawmindReviewDraftPicker";
import { LawmindRedlinePanel } from "./LawmindRedlinePanel";
import { usePaneResizePx } from "./use-pane-resize";
import { internalIdsTitle, pathBasename } from "./display-ids";

type Props = {
  apiBase: string;
  /** 当前助手 ID（写入 PROFILE 时使用） */
  assistantId?: string;
  /** 外部跳转到审核台时预选某份草稿 */
  initialTaskId?: string | null;
  /** 外部跳转到审核台时预置案件范围 */
  initialMatterId?: string | null;
  /** 外部跳转到审核台时预置状态筛选 */
  initialStatusFilter?: ArtifactDraft["reviewStatus"] | "all";
  /** 外部跳转到审核台时预置列表模式 */
  initialListMode?: "pending" | "all";
  /** 从案件页「去复核」进入时，用于顶栏显示返回入口 */
  returnMatterId?: string | null;
  /** 回到案件并恢复列表选中（与 returnMatterId 同时生效） */
  onReturnToMatter?: () => void;
  /** 打开工作区产物目录（Electron） */
  onShowArtifact?: (outputPath: string) => void;
  /** 审核或渲染成功后刷新侧栏任务列表 */
  onRecordsChanged?: () => void;
  /** 跳转主对话并关联草稿（验收「去对话补充」） */
  onGoToChat?: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  /** 后台修订任务已排队：跳转工作区并展示执行过程 */
  onRevisionJobQueued?: (opts: { sessionId: string; assistantId: string; taskId: string }) => void;
  /** 外部触发刷新（如后台修订完成并恢复待审核） */
  externalRefreshToken?: number;
  /** 四栏可见性（与顶栏分栏开关同步） */
  paneVisibility: ReviewPaneVisibility;
  _onToggleReviewPane: (id: ReviewPaneId) => void;
};

type ReviewSubmitBody = {
  status: "approved" | "rejected" | "modified";
  note?: string;
  appendToProfile: boolean;
  appendToLawyerProfile: boolean;
  profileAssistantId: string;
  labels?: string[];
  deferMemoryWrites?: true;
};

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  // Prefer RFC 5987 filename* if present.
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/^"|"$/g, ""));
    } catch {
      // fall through to plain filename
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  }
}

function _reviewStatusFilterLabel(status: ArtifactDraft["reviewStatus"] | "all"): string {
  switch (status) {
    case "pending":
      return "待审核";
    case "modified":
      return "需修改";
    case "approved":
      return "已通过";
    case "rejected":
      return "已驳回";
    case "all":
      return "全部状态";
  }
}

function executionStateLabel(state: TaskExecutionState | null): string {
  if (!state) {
    return "未知";
  }
  const statusLabel: Record<TaskExecutionState["status"], string> = {
    running: "进行中",
    awaiting_approval: "待审批",
    awaiting_clarification: "待澄清",
    completed: "已完成",
    failed: "失败",
  };
  const phaseLabel: Record<TaskExecutionState["phase"], string> = {
    clarify: "澄清",
    plan: "计划",
    research: "研判",
    draft: "起草",
    approval: "审批",
    render: "渲染",
    complete: "完成",
    error: "异常",
  };
  return `${phaseLabel[state.phase]} · ${statusLabel[state.status]}`;
}

export function ReviewWorkbench(props: Props) {
  const {
    apiBase,
    assistantId = "default",
    initialTaskId = null,
    initialMatterId = null,
    initialStatusFilter = "all",
    initialListMode = "pending",
    returnMatterId = null,
    onReturnToMatter,
    onShowArtifact,
    onRecordsChanged,
    onGoToChat,
    onRevisionJobQueued,
    externalRefreshToken = 0,
    paneVisibility,
    _onToggleReviewPane,
  } = props;
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">(() => initialListMode);
  const [statusFilter, setStatusFilter] = useState<ArtifactDraft["reviewStatus"] | "all">(
    () => initialStatusFilter,
  );
  const [matterFilter, setMatterFilter] = useState(() => (initialMatterId ?? "").trim());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => initialTaskId);
  const [detail, setDetail] = useState<ArtifactDraft | null>(null);
  const [citationIntegrity, setCitationIntegrity] = useState<DraftCitationIntegrityView | null>(null);
  const [acceptance, setAcceptance] = useState<AcceptanceReport | null>(null);
  const [executionState, setExecutionState] = useState<TaskExecutionState | null>(null);
  const [gateDecisions, setGateDecisions] = useState<GateDecision[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  /** 「需修改」后：发给助手的补充说明，随 revision-job 提交 */
  const [revisionDispatchNote, setRevisionDispatchNote] = useState("");
  const [revisionDispatchBusy, setRevisionDispatchBusy] = useState(false);
  const revisionPrefilledForTaskRef = useRef<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [, setReopenSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [appendToProfile, setAppendToProfile] = useState(false);
  const [appendToLawyerProfile, setAppendToLawyerProfile] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [deferMemoryWrites, setDeferMemoryWrites] = useState(false);
  const [memorySources, setMemorySources] = useState<MemorySourceLayer[] | null>(null);
  const [learningQueue, setLearningQueue] = useState<LearningSuggestionRecord[]>([]);
  const [learningBusy, setLearningBusy] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  /** 当前输出格式下可选的交付模板（内置 + 已启用上传） */
  const [templateCatalog, setTemplateCatalog] = useState<{
    builtIn: Array<{ id: string; format: string; label: string }>;
    uploaded: Array<{ id: string; format: string; label: string; enabled: boolean }>;
  } | null>(null);
  /** 渲染时使用的 templateId，可与文书草稿上的默认模板不同 */
  const [renderTemplateId, setRenderTemplateId] = useState("");
  const [editorValue, setEditorValue] = useState<DraftDocumentEditorValue | null>(null);
  const [savedEditorValue, setSavedEditorValue] = useState<DraftDocumentEditorValue | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
  const edition = useEdition(apiBase);

  const { width: reviewMetaWidth, onResizePointerDown: onReviewMetaResize } = usePaneResizePx({
    storageKey: "lawmind.ui.reviewWorkbenchMetaWidth",
    defaultWidth: 272,
    min: LM_PANE_MIN_WIDTH_PX,
    max: 400,
  });

  const { width: reviewEditorWidth, onResizePointerDown: onReviewEditorResize } = usePaneResizePx({
    storageKey: "lawmind.ui.reviewWorkbenchEditorWidth",
    defaultWidth: 340,
    min: LM_PANE_MIN_WIDTH_PX,
    max: 480,
  });

  const loadLearningQueue = useCallback(async () => {
    try {
      const j = await apiGetJson<{ ok?: boolean; suggestions?: LearningSuggestionRecord[] }>(
        apiBase,
        "/api/learning/suggestions",
      );
      if (j.ok && Array.isArray(j.suggestions)) {
        setLearningQueue(j.suggestions);
      }
    } catch {
      /* ignore */
    }
  }, [apiBase]);

  useEffect(() => {
    void loadLearningQueue();
  }, [loadLearningQueue]);

  useEffect(() => {
    void (async () => {
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          builtIn?: Array<{ id: string; format: string; label: string }>;
          uploaded?: Array<{ id: string; format: string; label: string; enabled: boolean }>;
        }>(apiBase, "/api/templates");
        if (j.ok && Array.isArray(j.builtIn) && Array.isArray(j.uploaded)) {
          setTemplateCatalog({ builtIn: j.builtIn, uploaded: j.uploaded });
        } else {
          setTemplateCatalog(null);
        }
      } catch {
        setTemplateCatalog(null);
      }
    })();
  }, [apiBase]);

  const loadDrafts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const j = await apiGetJson<{ ok?: boolean; drafts?: ArtifactDraft[] }>(apiBase, "/api/drafts");
      if (j.ok && Array.isArray(j.drafts)) {
        setDrafts(j.drafts);
        return;
      }
      throw new Error(messageFromOkFalseBody(j, "加载草稿列表失败"));
    } catch (e) {
      setError(errorMessage(e, "加载草稿列表失败"));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    if (initialTaskId) {
      setSelectedTaskId(initialTaskId);
    }
    setMatterFilter(initialMatterId ?? "");
    setStatusFilter(initialStatusFilter);
    setFilter(initialListMode);
  }, [initialTaskId, initialListMode, initialMatterId, initialStatusFilter]);

  const loadDetail = useCallback(
    async (taskId: string, opts?: { preserveContent?: boolean }) => {
      setDetailLoading(true);
      if (!opts?.preserveContent) {
        setDetail(null);
        setCitationIntegrity(null);
        setAcceptance(null);
        setExecutionState(null);
        setGateDecisions([]);
        setActionMsg(null);
      }
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
          memorySources?: MemorySourceLayer[];
          acceptance?: AcceptanceReport;
          executionState?: TaskExecutionState;
          gateDecisions?: GateDecision[];
        }>(apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
        if (!j.ok || !j.draft) {
          throw new Error(messageFromOkFalseBody(j, "加载草稿失败"));
        }
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setMemorySources(Array.isArray(j.memorySources) ? j.memorySources : null);
        setAcceptance(j.acceptance ?? null);
        setExecutionState(j.executionState ?? null);
        const gates =
          Array.isArray(j.gateDecisions) && j.gateDecisions.length > 0
            ? j.gateDecisions
            : deriveReviewGateDecisions(j.draft, j.acceptance);
        setGateDecisions(gates);
        const nextEditor = draftDocumentEditorValueFromDraft(j.draft);
        setEditorValue(nextEditor);
        setSavedEditorValue(nextEditor);
        setEditorSaveError(null);
      } catch (e) {
        setActionMsg(errorMessage(e, "加载草稿失败"));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (!externalRefreshToken) {
      return;
    }
    setFilter("pending");
    setStatusFilter("pending");
    revisionPrefilledForTaskRef.current = null;
    setRevisionDispatchNote("");
    void (async () => {
      await loadDrafts({ silent: true });
      const taskId = (initialTaskId ?? selectedTaskId)?.trim();
      if (taskId) {
        await loadDetail(taskId, { preserveContent: true });
        setActionMsg("助手已完成修订，草稿已恢复为「待审核」。请在文档正文区查看并再次签批。");
      }
      onRecordsChanged?.();
    })();
  }, [externalRefreshToken, initialTaskId, loadDetail, loadDrafts, onRecordsChanged, selectedTaskId]);

  useEffect(() => {
    if (selectedTaskId) {
      void loadDetail(selectedTaskId);
    } else {
      setDetail(null);
      setCitationIntegrity(null);
      setMemorySources(null);
      setAcceptance(null);
      setExecutionState(null);
      setGateDecisions([]);
    }
  }, [selectedTaskId, loadDetail]);

  useEffect(() => {
    if (!detail) {
      setEditorValue(null);
      setSavedEditorValue(null);
      setEditorSaveError(null);
      return;
    }
    const nextEditor = draftDocumentEditorValueFromDraft(detail);
    setEditorValue(nextEditor);
    setSavedEditorValue(nextEditor);
    setEditorSaveError(null);
  }, [detail]);

  const editorDirty = useMemo(() => {
    if (!editorValue || !savedEditorValue) {
      return false;
    }
    return !draftDocumentEditorValuesEqual(editorValue, savedEditorValue);
  }, [editorValue, savedEditorValue]);

  const saveDraftContent = useCallback(async () => {
    if (!selectedTaskId || !editorValue || !editorDirty) {
      return;
    }
    setEditorSaving(true);
    setEditorSaveError(null);
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
        ReturnType<typeof draftDocumentEditorValueToPatch>
      >(
        apiBase,
        `/api/drafts/${encodeURIComponent(selectedTaskId)}/content`,
        "PATCH",
        draftDocumentEditorValueToPatch(editorValue),
      );
      if (!j.ok || !j.draft) {
        throw new Error(messageFromOkFalseBody(j, "保存正文失败"));
      }
      setDetail(j.draft);
      setCitationIntegrity(j.citationIntegrity ?? null);
      setAcceptance(j.acceptance ?? null);
      setExecutionState(j.executionState ?? null);
      setGateDecisions(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
      const saved = draftDocumentEditorValueFromDraft(j.draft);
      setEditorValue(saved);
      setSavedEditorValue(saved);
      setActionMsg("正文已保存。验收门禁已按最新内容重新计算。");
      await loadDrafts({ silent: true });
      onRecordsChanged?.();
    } catch (e) {
      setEditorSaveError(errorMessage(e, "保存正文失败"));
    } finally {
      setEditorSaving(false);
    }
  }, [apiBase, editorDirty, editorValue, loadDrafts, onRecordsChanged, selectedTaskId]);

  useEffect(() => {
    if (!detail || detail.reviewStatus !== "modified") {
      revisionPrefilledForTaskRef.current = null;
      return;
    }
    if (revisionPrefilledForTaskRef.current === detail.taskId) {
      return;
    }
    revisionPrefilledForTaskRef.current = detail.taskId;
    const notes = detail.reviewNotes ?? [];
    if (notes.length > 0) {
      setRevisionDispatchNote(notes[notes.length - 1].trim());
    } else {
      setRevisionDispatchNote("");
    }
  }, [detail]);

  const templateOptions = useMemo(() => {
    if (!detail || !templateCatalog) {
      return [] as Array<{ id: string; label: string; kind: "built-in" | "uploaded" }>;
    }
    const fmt = detail.output;
    if (fmt !== "docx" && fmt !== "pptx") {
      return [];
    }
    const builtIn = templateCatalog.builtIn
      .filter((t) => t.format === fmt)
      .map((t) => ({ id: t.id, label: t.label, kind: "built-in" as const }));
    const uploaded = templateCatalog.uploaded
      .filter((t) => t.format === fmt && t.enabled)
      .map((t) => ({ id: t.id, label: t.label, kind: "uploaded" as const }));
    return [...builtIn, ...uploaded];
  }, [detail, templateCatalog]);

  useEffect(() => {
    if (!detail) {
      setRenderTemplateId("");
      return;
    }
    if (templateOptions.length === 0) {
      setRenderTemplateId(detail.templateId ?? "");
      return;
    }
    setRenderTemplateId((cur) => {
      if (cur && templateOptions.some((o) => o.id === cur)) {
        return cur;
      }
      if (detail.templateId && templateOptions.some((o) => o.id === detail.templateId)) {
        return detail.templateId;
      }
      return templateOptions[0].id;
    });
  }, [detail, templateOptions]);

  const filtered = useMemo(() => {
    return drafts.filter((draft) => {
      const st = draft.reviewStatus ?? "pending";
      if (filter === "pending" && st !== "pending") {
        return false;
      }
      if (statusFilter !== "all" && st !== statusFilter) {
        return false;
      }
      if (matterFilter.trim() && draft.matterId !== matterFilter.trim()) {
        return false;
      }
      return true;
    });
  }, [drafts, filter, matterFilter, statusFilter]);

  const submitReopenReview = async () => {
    if (!selectedTaskId) {
      return;
    }
    if (!apiBase?.trim()) {
      setActionMsg("未配置本地服务地址，无法操作。请确认已打开工作区并连接本机 LawMind 服务。");
      return;
    }
    setReopenSubmitting(true);
    setActionBusy(true);
    // 不要先置空：否则在慢请求期间界面像「完全没反应」。
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
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setAcceptance(j.acceptance ?? null);
        setExecutionState(j.executionState ?? null);
        setGateDecisions(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
        const nextEditor = draftDocumentEditorValueFromDraft(j.draft);
        setEditorValue(nextEditor);
        setSavedEditorValue(nextEditor);
        setEditorSaveError(null);
      } else {
        void loadDetail(selectedTaskId);
      }
      onRecordsChanged?.();
    } catch (e) {
      const err = errorMessage(e, "恢复待审核失败");
      setActionMsg(
        `${err} 若一直失败，请确认本应用与本地服务为同一版本并已重启。`,
      );
    } finally {
      setActionBusy(false);
      setReopenSubmitting(false);
    }
  };

  const submitReview = async (status: "approved" | "rejected" | "modified") => {
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
        msg =
          "已记录驳回。助手不会自动处理：请在主对话中说明后续如何办理或是否重做。";
      }
      if (j.profileLearningSkipped || j.lawyerProfileLearningSkipped) {
        msg +=
          " 助手/律师档案中已有该任务对应的学习记录，本次未重复写入。";
      }
      setActionMsg(msg);
      await loadDrafts();
      void loadLearningQueue();
      if (j.draft) {
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setExecutionState(j.executionState ?? null);
        setGateDecisions(Array.isArray(j.gateDecisions) ? j.gateDecisions : []);
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
  };

  const adoptSuggestion = async (id: string) => {
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
  };

  const dismissSuggestion = async (id: string) => {
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
  };

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
  }, [apiBase, assistantId, detail?.reviewStatus, onRevisionJobQueued, revisionDispatchNote, selectedTaskId]);

  const submitRender = async (opts?: { strict?: boolean }) => {
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
      const strictQs =
        opts?.strict === false ? "?strict=false" : "";
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
          setAcceptance(j.acceptance);
        }
        throw new Error(messageFromOkFalseBody(j, "渲染失败"));
      }
      if (j.acceptance) {
        setAcceptance(j.acceptance);
      }
      if (j.executionState) {
        setExecutionState(j.executionState);
      }
      if (Array.isArray(j.gateDecisions)) {
        setGateDecisions(j.gateDecisions);
      }
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
  };

  const downloadAcceptancePack = async () => {
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
  };

  const showMatterEntryBar = Boolean(returnMatterId?.trim() && onReturnToMatter);
  const hasDetailPane = Boolean(selectedTaskId && !detailLoading && detail && editorValue);
  const growReviewPaneId = useMemo(
    () => lastVisibleReviewPaneId(paneVisibility),
    [paneVisibility],
  );

  const reviewPaneLayoutStyle = (id: ReviewPaneId): CSSProperties => {
    if (growReviewPaneId === id) {
      return { flex: "1 1 0", minWidth: 0, minHeight: 0, width: "100%", maxWidth: "none" };
    }
    const widthPx = id === "meta" ? reviewMetaWidth : reviewEditorWidth;
    return { flex: `0 0 ${widthPx}px`, width: widthPx, minWidth: 0, minHeight: 0 };
  };

  const reviewPaneClassName = (base: string, id: ReviewPaneId): string =>
    growReviewPaneId === id ? `${base} lm-review-pane-grow` : base;

  const renderReviewSplit = (
    afterPane: ReviewPaneId,
    onResize: (e: ReactPointerEvent) => void,
    label: string,
  ) => {
    if (!hasVisibleReviewPaneAfter(afterPane, paneVisibility, hasDetailPane)) {
      return null;
    }
    return (
      <div
        className="lm-split-handle lm-split-handle-vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title={label}
        onPointerDown={onResize}
      />
    );
  };

  return (
    <div className="lm-review-workbench-root">
      {showMatterEntryBar && (
        <div className="lm-review-matter-bar" role="status">
          <span className="lm-review-matter-bar-text">
            从案件 <strong>{returnMatterId?.trim()}</strong> 过来审这份草稿
          </span>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-small"
            onClick={() => onReturnToMatter?.()}
          >
            返回案件
          </button>
        </div>
      )}
      <div className="lm-review-pane-toolbar">
        <LawmindReviewDraftPicker
          drafts={drafts}
          filtered={filtered}
          selectedTaskId={selectedTaskId}
          onSelectTaskId={setSelectedTaskId}
          filter={filter}
          onFilterChange={setFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          matterFilter={matterFilter}
          onMatterFilterChange={setMatterFilter}
          loading={loading}
          error={error}
          onRefresh={() => void loadDrafts()}
        />
      </div>
      <div className="lm-workbench lm-review-workbench">
      {!selectedTaskId && !detailLoading && (
        <div className="lm-review-detail-row lm-review-detail-empty">
          <div className="lm-meta lm-workbench-placeholder">在上方选择草稿后开始审阅与签批</div>
        </div>
      )}
      {selectedTaskId && detailLoading && (
        <div className="lm-review-detail-row lm-review-detail-empty">
          <div className="lm-meta">加载草稿…</div>
        </div>
      )}
      {hasDetailPane && detail && editorValue && (
        <div className="lm-review-detail-row">
          {paneVisibility.meta ? (
          <div
            className={reviewPaneClassName("lm-review-meta-pane", "meta")}
            style={reviewPaneLayoutStyle("meta")}
          >
            <div className="lm-review-meta-pane-scroll lm-review-scroll">
            <div className="lm-review-self-check-sticky">
              <LawmindReviewSelfCheckSummary
                acceptance={acceptance}
                citation={citationIntegrity}
                deliverableType={detail.deliverableType}
                gateDecisions={gateDecisions}
              />
            </div>
            <div className="lm-callout lm-callout-muted" role="status" aria-live="polite">
              <p className="lm-callout-title">执行状态看板</p>
              <p className="lm-callout-body">
                {executionStateLabel(executionState)}
                {executionState?.detail ? ` · ${executionState.detail}` : ""}
              </p>
              {gateDecisions.length > 0 ? (
                <div className="lm-review-gate-list">
                  {gateDecisions.map((gate, idx) => (
                    <span key={`${gate.gate}-${idx}`} className={gateDecisionBadgeClass(gate.decision)}>
                      {gateDecisionLabel(gate.gate)}
                      {gate.reason ? `：${gate.reason}` : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div id="lm-review-citation-banner">
              <LawmindCitationBanner view={citationIntegrity} apiBase={apiBase} taskId={selectedTaskId ?? undefined} />
            </div>
            {selectedTaskId ? (
              <LawmindRedlinePanel
                apiBase={apiBase}
                taskId={selectedTaskId}
                onDraftUpdated={() => {
                  void loadDetail(selectedTaskId);
                }}
              />
            ) : null}
            {learningQueue.length > 0 && (
              <div className="lm-review-learning-queue">
                <div className="lm-review-learning-queue-header">
                  <strong>学习队列</strong>
                  <span className="lm-meta">{learningQueue.length} 条待采纳</span>
                </div>
                <ul className="lm-review-learning-list">
                  {learningQueue.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <span
                        className="lm-meta"
                        title={internalIdsTitle([{ label: "关联草稿任务", value: s.taskId }])}
                      >
                        {s.labels.join("、").trim() || "一条模型生成的升级建议"}
                      </span>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={learningBusy === s.id}
                        onClick={() => void adoptSuggestion(s.id)}
                      >
                        采纳写回
                      </button>
                      <button
                        type="button"
                        className="lm-btn lm-btn-secondary lm-btn-small"
                        disabled={learningBusy === s.id}
                        onClick={() => void dismissSuggestion(s.id)}
                      >
                        忽略
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {memorySources && memorySources.length > 0 ? (
              <LawmindMemorySourcesPanel layers={memorySources} variant="workbench" />
            ) : null}
            <LawmindAcceptanceGate
              report={acceptance}
              defaultCollapsed
              onGoFillInChat={
                onGoToChat && selectedTaskId
                  ? (prompt) =>
                      onGoToChat({
                        taskId: selectedTaskId,
                        matterId: detail.matterId,
                        prompt,
                      })
                  : undefined
              }
            />
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={deferMemoryWrites}
                onChange={(e) => {
                  setDeferMemoryWrites(e.target.checked);
                  if (e.target.checked) {
                    setAppendToProfile(false);
                    setAppendToLawyerProfile(false);
                  }
                }}
                disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
              />
              <span>学习队列（稍后采纳）</span>
            </label>
            <div className="lm-review-labels">
              <span className="lm-review-labels-title">审核标签（可选，驱动质量学习）</span>
              <div className="lm-review-labels-grid">
                {ALL_REVIEW_LABELS.map((lb) => (
                  <label key={lb} className="lm-review-label-chip">
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(lb)}
                      disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                      onChange={() => {
                        setSelectedLabels((prev) => {
                          const next = new Set(prev);
                          if (next.has(lb)) {
                            next.delete(lb);
                          } else {
                            next.add(lb);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>{lb}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToProfile}
                disabled={deferMemoryWrites || actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                onChange={(e) => setAppendToProfile(e.target.checked)}
              />
              <span>
                将本条审核摘要记入本助手档案（
                <code>{`assistants/${assistantId}/PROFILE.md`}</code>）
              </span>
            </label>
            <label className="lm-review-profile-toggle">
              <input
                type="checkbox"
                checked={appendToLawyerProfile}
                disabled={deferMemoryWrites || actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                onChange={(e) => setAppendToLawyerProfile(e.target.checked)}
              />
              <span>
                将本条审核摘要记入工作区律师档案「八、个人积累」（<code>LAWYER_PROFILE.md</code>）
              </span>
            </label>

            <div className="lm-workbench-toolbar lm-review-doc-head">
              <div>
                <h2>{detail.title}</h2>
                <p
                  className="lm-meta"
                  title={internalIdsTitle([
                    { label: "任务编号", value: detail.taskId },
                    { label: "案件编号", value: detail.matterId ?? undefined },
                    { label: "模板编号", value: detail.templateId },
                  ])}
                >
                  {detail.output ? `输出文件：${pathBasename(detail.output)}` : "输出路径待定"}
                  {detail.templateId ? " · 已绑定交付模板" : ""}
                  · 签批 {reviewStatusDisplayLabel(detail.reviewStatus)}
                </p>
                {(detail.reviewStatus ?? "pending") !== "pending" ? (
                  <p className="lm-meta lm-review-signoff-locked">
                    状态「{reviewStatusDisplayLabel(detail.reviewStatus)}」：需重审时请先恢复为待审核。
                  </p>
                ) : null}
                {templateOptions.length > 0 ? (
                  <label className="lm-review-template-pick">
                    <span>交付模板</span>
                    <select
                      value={renderTemplateId}
                      onChange={(e) => {
                        setRenderTemplateId(e.target.value);
                      }}
                      disabled={actionBusy}
                    >
                      {templateOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                          {o.kind === "uploaded" ? "（上传）" : "（内置）"} — {o.id}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
            </div>
            <LawmindReviewDeliveryBar
              reviewStatus={detail.reviewStatus}
              acceptance={acceptance}
              actionBusy={actionBusy}
              lastOutputPath={lastExportPath ?? detail.output ?? null}
              onApprove={() => void submitReview("approved")}
              onReject={() => void submitReview("rejected")}
              onModify={() => void submitReview("modified")}
              onReopen={() => void submitReopenReview()}
              onExportWord={(opts) => void submitRender(opts)}
              onShowInFolder={onShowArtifact}
              packExportEnabled={edition.features.acceptancePackExport}
              onDownloadPack={() => void downloadAcceptancePack()}
              packBusy={packBusy}
            />

            {detail.reviewStatus === "modified" ? (
              <div
                className="lm-callout lm-callout-info lm-review-revision-dispatch"
                role="region"
                aria-label="交给助手后台修订"
              >
                <p className="lm-callout-title">交给助手后台修订</p>
                <p className="lm-callout-body">
                  签批为「需修改」后，正文不会自动变化。下方说明会与会话中已保存的审核备注一并发给助手；点击提交后由本机在**后台**新开一轮助手对话执行改稿（无需先切到工作区输入框）。
                </p>
                <p className="lm-meta">
                  任务编号 <code>{detail.taskId}</code>
                  {detail.matterId ? (
                    <>
                      {" "}
                      · 案件 <code>{detail.matterId}</code>
                    </>
                  ) : null}
                </p>
                <label className="lm-review-note lm-review-revision-dispatch-note">
                  <span className="lm-review-note-title">发给助手的补充说明（可选）</span>
                  <textarea
                    value={revisionDispatchNote}
                    onChange={(e) => setRevisionDispatchNote(e.target.value)}
                    placeholder="可在此写清希望助手如何改结构、补条款、调语气等；若不写，助手将主要依据签批阶段记入草稿的审核备注处理。"
                    rows={5}
                    disabled={revisionDispatchBusy || actionBusy}
                  />
                </label>
                <div className="lm-review-revision-dispatch-actions">
                  <button
                    type="button"
                    className="lm-btn lm-btn-accent"
                    disabled={revisionDispatchBusy || actionBusy}
                    onClick={() => void submitRevisionJob()}
                  >
                    {revisionDispatchBusy ? "提交中…" : "提交给助手（后台执行）"}
                  </button>
                </div>
                <p className="lm-meta lm-review-revision-dispatch-foot">
                  提交后将自动打开工作区并在对话中展示执行过程；修订成功后会自动恢复为「待审核」并回到本页，无需手动刷新或点「恢复待审核」。
                </p>
              </div>
            ) : null}

            {detail.reviewStatus === "rejected" ? (
              <div
                className="lm-callout lm-callout-info lm-review-next-steps"
                role="region"
                aria-label="签批后的下一步"
              >
                <p className="lm-callout-title">助手会不会自动改稿？</p>
                <p className="lm-callout-body">
                  不会。驳回后也不会自动删稿。若仍要交付，请在主对话中说明如何修改或重做；需要重新签批时，可先点「恢复待审核」。
                  {detail.matterId ? <> 关联案件工作台可能出现「草稿待修订」类待办，便于跟进。</> : null}
                </p>
              </div>
            ) : null}

            {actionMsg ? (
              <div className="lm-meta lm-review-msg" role="status" aria-live="polite">
                {actionMsg}
              </div>
            ) : null}

            {detail.outputPath ? (
              <div className="lm-meta">
                已有交付路径：{detail.outputPath}{" "}
                {onShowArtifact && (
                  <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onShowArtifact(detail.outputPath!)}>
                    在文件夹中显示
                  </button>
                )}
              </div>
            ) : null}

            <label className="lm-review-note">
              <span className="lm-review-note-title">审核备注（可选）</span>
              <span className="lm-meta lm-review-note-hint">
                备注与本次签批一并提交：请先写好备注，再点上方「通过」「驳回」或「需修改」。若已签批，需先点「恢复待审核」才能再次附带备注签批。
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：须补充××条款依据、与当事人核实××事实后再定稿…"
                rows={4}
                disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                aria-disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
              />
            </label>
            </div>
          </div>
          ) : null}

          {paneVisibility.meta
            ? renderReviewSplit("meta", onReviewMetaResize, "调整签批区宽度")
            : null}

          {paneVisibility.editor ? (
          <div
            className={reviewPaneClassName("lm-review-editor-pane", "editor")}
            style={reviewPaneLayoutStyle("editor")}
          >
            <LawmindDraftDocumentEditor
              taskId={detail.taskId}
              apiBase={apiBase}
              value={editorValue}
              onChange={setEditorValue}
              editable={isDraftDocumentEditable(detail.reviewStatus)}
              dirty={editorDirty}
              saving={editorSaving}
              saveError={editorSaveError}
              onSave={() => void saveDraftContent()}
              onRevert={() => {
                if (savedEditorValue) {
                  setEditorValue(savedEditorValue);
                  setEditorSaveError(null);
                }
              }}
              reviewStatus={detail.reviewStatus}
            />
          </div>
          ) : null}

          {paneVisibility.editor
            ? renderReviewSplit("editor", onReviewEditorResize, "调整文档编辑区宽度")
            : null}

          {paneVisibility.preview ? (
          <div
            className={reviewPaneClassName("lm-review-preview-pane", "preview")}
            style={reviewPaneLayoutStyle("preview")}
          >
            <LawmindDraftDocumentPreview
              taskId={detail.taskId}
              apiBase={apiBase}
              value={editorValue}
              outputPath={lastExportPath ?? detail.outputPath ?? null}
              reviewStatusLabel={
                editorDirty ? "预览（含未保存修改）" : reviewStatusDisplayLabel(detail.reviewStatus)
              }
            />
          </div>
          ) : null}
        </div>
      )}
    </div>
    </div>
  );
}
