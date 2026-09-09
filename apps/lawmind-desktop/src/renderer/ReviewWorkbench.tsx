/**
 * 文书台 — 改稿 · 批注 · 模板实时预览 · 导出。
 * 正式通过 / 驳回 / 需修改主路径在「在办」；高级区保留必核后的兜底签批。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import { assessDeliverableReadiness } from "../../../../src/lawmind/deliverables/deliverable-readiness.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../src/lawmind/platform/contracts.ts";
import type { LearningSuggestionRecord } from "../../../../src/lawmind/learning/suggestion-queue.ts";
import {
  draftDocumentEditorValueFromDraft,
  draftDocumentEditorValuesEqual,
  draftDocumentEditorValueToPatch,
  type DraftDocumentEditorValue,
} from "./lawmind-draft-document-editor";
import { apiGetJson, errorMessage, messageFromOkFalseBody } from "./api-client";
import type { DraftContentPatchBody } from "./lawmind-api-request-types.ts";
import { apiPatchDraftContent } from "./lawmind-api-routes.ts";
import { useEdition } from "./use-edition";
import { LM_PANE_MIN_WIDTH_PX } from "./lawmind-panel-layout";
import {
  hasVisibleReviewPaneAfter,
  lastVisibleReviewPaneId,
  type ReviewPaneId,
} from "./lawmind-review-pane-prefs";
import { useReviewPaneVisibilityStore } from "./stores/review-pane-visibility-store";
import { LawmindReviewDraftPicker } from "./LawmindReviewDraftPicker";
import { usePaneResizePx } from "./use-pane-resize";
import { useReviewWorkbenchData } from "./review/useReviewWorkbenchData";
import { useReviewWorkbenchActions } from "./review/useReviewWorkbenchActions";
import { ReviewWorkbenchDocumentColumn } from "./review/ReviewWorkbenchDocumentColumn";
import { ReviewWorkbenchMetaColumn } from "./review/ReviewWorkbenchMetaColumn";
import type { VerificationChecklistView } from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import { buildChecklistView } from "../../../../src/lawmind/deliverables/verification-checklist.ts";
import type { ReviewCampaign } from "./lawmind-review-campaign-api";

type Props = {
  apiBase: string;
  assistantId?: string;
  initialTaskId?: string | null;
  initialMatterId?: string | null;
  initialStatusFilter?: ArtifactDraft["reviewStatus"] | "all";
  initialListMode?: "pending" | "all";
  returnMatterId?: string | null;
  onReturnToMatter?: () => void;
  onShowArtifact?: (outputPath: string) => void;
  onRecordsChanged?: () => void;
  onGoToChat?: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  /** 文书台 → 在办：正式签批队列 */
  onOpenAgentsDesk?: () => void;
  onRevisionJobQueued?: (opts: { sessionId: string; assistantId: string; taskId: string }) => void;
  externalRefreshToken?: number;
};

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
    onOpenAgentsDesk,
    onRevisionJobQueued,
    externalRefreshToken = 0,
  } = props;

  const paneVisibility = useReviewPaneVisibilityStore((s) => s.visibility);

  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [checklistView, setChecklistView] = useState<VerificationChecklistView | null>(null);
  const [checklistChecked, setChecklistChecked] = useState<Record<string, boolean>>({});
  const [campaign, setCampaign] = useState<ReviewCampaign | null>(null);
  const [revisionDispatchNote, setRevisionDispatchNote] = useState("");
  const [appendToProfile, setAppendToProfile] = useState(false);
  const [appendToLawyerProfile, setAppendToLawyerProfile] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [deferMemoryWrites, setDeferMemoryWrites] = useState(false);
  const [learningQueue, setLearningQueue] = useState<LearningSuggestionRecord[]>([]);
  const [learningBusy, setLearningBusy] = useState<string | null>(null);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [templateCatalog, setTemplateCatalog] = useState<{
    builtIn: Array<{ id: string; format: string; label: string }>;
    uploaded: Array<{ id: string; format: string; label: string; enabled: boolean }>;
  } | null>(null);
  const [renderTemplateId, setRenderTemplateId] = useState("");
  const [includeProvenance, setIncludeProvenance] = useState(false);
  const [editorValue, setEditorValue] = useState<DraftDocumentEditorValue | null>(null);
  const [savedEditorValue, setSavedEditorValue] = useState<DraftDocumentEditorValue | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorSaveError, setEditorSaveError] = useState<string | null>(null);
  const edition = useEdition(apiBase);

  const {
    drafts,
    loading,
    error,
    filter,
    setFilter,
    statusFilter,
    setStatusFilter,
    matterFilter,
    setMatterFilter,
    selectedTaskId,
    setSelectedTaskId,
    detail,
    citationIntegrity,
    memorySources,
    acceptance,
    reasoningReport,
    reasoningMarkdown,
    executionState,
    clauses,
    scaffold,
    gateDecisions,
    detailLoading,
    detailError,
    filtered,
    loadDrafts,
    loadDetail,
    applyDetailFromResponse,
    revisionPrefilledForTaskRef,
  } = useReviewWorkbenchData({
    apiBase,
    initialTaskId,
    initialMatterId,
    initialStatusFilter,
    initialListMode,
    externalRefreshToken,
    onRecordsChanged,
    onExternalRefreshMessage: setActionMsg,
  });

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

  useEffect(() => {
    if (detailError) {
      setActionMsg(detailError);
    }
  }, [detailError]);

  useEffect(() => {
    if (!externalRefreshToken) {
      return;
    }
    setRevisionDispatchNote("");
  }, [externalRefreshToken]);

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

  const saveDraftContent = useCallback(async (): Promise<boolean> => {
    if (!selectedTaskId || !editorValue || !editorDirty) {
      return true;
    }
    setEditorSaving(true);
    setEditorSaveError(null);
    try {
      const j = (await apiPatchDraftContent(
        apiBase,
        selectedTaskId,
        draftDocumentEditorValueToPatch(editorValue) as DraftContentPatchBody,
      )) as {
        ok?: boolean;
        error?: string;
        draft?: ArtifactDraft;
        citationIntegrity?: DraftCitationIntegrityView;
        acceptance?: AcceptanceReport;
        executionState?: TaskExecutionState;
        gateDecisions?: GateDecision[];
      };
      if (!j.ok || !j.draft) {
        throw new Error(messageFromOkFalseBody(j, "保存正文失败"));
      }
      applyDetailFromResponse(selectedTaskId, j);
      const saved = draftDocumentEditorValueFromDraft(j.draft);
      setEditorValue(saved);
      setSavedEditorValue(saved);
      setActionMsg("正文已保存。出稿检查已按最新内容更新。");
      await loadDrafts({ silent: true });
      onRecordsChanged?.();
      return true;
    } catch (e) {
      setEditorSaveError(errorMessage(e, "保存正文失败"));
      return false;
    } finally {
      setEditorSaving(false);
    }
  }, [
    apiBase,
    applyDetailFromResponse,
    editorDirty,
    editorValue,
    loadDrafts,
    onRecordsChanged,
    selectedTaskId,
  ]);

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
  }, [detail, revisionPrefilledForTaskRef]);

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

  const {
    actionBusy,
    revisionDispatchBusy,
    packBusy,
    submitReopenReview,
    submitReview,
    submitRender,
    submitRenderTracked,
    submitRevisionJob,
    deleteSelectedDraft,
    downloadAcceptancePack,
    adoptSuggestion,
    dismissSuggestion,
  } = useReviewWorkbenchActions({
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
    syncEditorFromDraft: (draft) => {
      const nextEditor = draftDocumentEditorValueFromDraft(draft);
      setEditorValue(nextEditor);
      setSavedEditorValue(nextEditor);
    },
    clearEditorSaveError: () => setEditorSaveError(null),
    setSelectedTaskId,
    checklistChecked,
    editorDirty,
    saveDraftContent,
  });

  useEffect(() => {
    if (!detail) {
      setChecklistView(null);
      setChecklistChecked({});
      setCampaign(null);
      return;
    }
    const view = buildChecklistView(
      detail.deliverableType,
      detail.verificationChecklist ?? null,
    );
    setChecklistView(view);
    setChecklistChecked({ ...view.state.checked });
    setCampaign(null);
  }, [detail?.taskId, detail?.deliverableType, detail?.verificationChecklist?.updatedAt]);

  const checklistBlocksApprove = useMemo(() => {
    if (!checklistView || (detail?.reviewStatus ?? "pending") !== "pending") {
      return false;
    }
    const required = checklistView.spec.items.filter((i) => i.required);
    return required.some((i) => !checklistChecked[i.id]);
  }, [checklistView, checklistChecked, detail?.reviewStatus]);

  const deliverableReadiness = useMemo(() => {
    if (!detail) {
      return null;
    }
    return assessDeliverableReadiness({
      draft: detail,
      checklistState: {
        specId: checklistView?.spec.id ?? "",
        checked: checklistChecked,
      },
      citationIntegrity,
      citationMode: edition.citationMode,
      citationGateStrict: edition.features.citationGateStrict,
      reasoningReport,
    });
  }, [
    detail,
    checklistView?.spec.id,
    checklistChecked,
    citationIntegrity,
    edition.citationMode,
    edition.features.citationGateStrict,
    reasoningReport,
  ]);

  const showMatterEntryBar = Boolean(returnMatterId?.trim() && onReturnToMatter);
  const hasDetailPane = Boolean(selectedTaskId && !detailLoading && detail && editorValue);
  const growReviewPaneId = useMemo(() => lastVisibleReviewPaneId(paneVisibility), [paneVisibility]);

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
            <div className="lm-meta lm-workbench-placeholder">在上方选择草稿后开始改稿与预览</div>
          </div>
        )}
        {selectedTaskId && detailLoading && (
          <div
            className="lm-review-detail-row lm-review-detail-empty"
            role="status"
            aria-busy="true"
            aria-label="草稿加载中"
          >
            <div className="lm-meta">加载草稿…</div>
          </div>
        )}
        {hasDetailPane && detail && editorValue && selectedTaskId ? (
          <div className="lm-review-detail-row">
            {paneVisibility.meta ? (
              <ReviewWorkbenchMetaColumn
                apiBase={apiBase}
                assistantId={assistantId}
                detail={detail}
                selectedTaskId={selectedTaskId}
                acceptance={acceptance}
                reasoningReport={reasoningReport}
                reasoningMarkdown={reasoningMarkdown}
                citationIntegrity={citationIntegrity}
                citationGateStrict={edition.features.citationGateStrict}
                citationMode={edition.citationMode}
                checklistView={checklistView}
                checklistChecked={checklistChecked}
                onChecklistToggle={(id, value) =>
                  setChecklistChecked((prev) => ({ ...prev, [id]: value }))
                }
                checklistBlocksApprove={checklistBlocksApprove}
                readiness={deliverableReadiness}
                campaign={campaign}
                onCampaignChange={setCampaign}
                clauses={clauses}
                scaffold={scaffold}
                gateDecisions={gateDecisions}
                executionState={executionState}
                memorySources={memorySources}
                learningQueue={learningQueue}
                learningBusy={learningBusy}
                onAdoptSuggestion={(id) => void adoptSuggestion(id, setLearningBusy)}
                onDismissSuggestion={(id) => void dismissSuggestion(id, setLearningBusy)}
                onDraftUpdated={() => void loadDetail(selectedTaskId)}
                onGoToChat={onGoToChat}
                onOpenAgentsDesk={onOpenAgentsDesk}
                deferMemoryWrites={deferMemoryWrites}
                onDeferMemoryWritesChange={(checked) => {
                  setDeferMemoryWrites(checked);
                  if (checked) {
                    setAppendToProfile(false);
                    setAppendToLawyerProfile(false);
                  }
                }}
                selectedLabels={selectedLabels}
                onSelectedLabelsChange={setSelectedLabels}
                appendToProfile={appendToProfile}
                onAppendToProfileChange={setAppendToProfile}
                appendToLawyerProfile={appendToLawyerProfile}
                onAppendToLawyerProfileChange={setAppendToLawyerProfile}
                actionBusy={actionBusy}
                lastExportPath={lastExportPath}
                onApprove={() => void submitReview("approved")}
                onReject={() => void submitReview("rejected")}
                onModify={() => void submitReview("modified")}
                onReopen={() => void submitReopenReview()}
                onDeleteDraft={() => void deleteSelectedDraft()}
                onExportWord={() => void submitRender({ includeProvenance })}
                onExportTrackedWord={() => void submitRenderTracked({ includeProvenance })}
                onShowArtifact={onShowArtifact}
                onOpenWithSystem={async (relPath) => {
                  if (!window.lawmindDesktop?.openWithSystem) {
                    setActionMsg("当前环境无法调用本机 Word；请用「在文件夹中显示」后手动打开。");
                    return;
                  }
                  const r = await window.lawmindDesktop.openWithSystem({
                    root: "workspace",
                    path: relPath,
                  });
                  if (r && !r.ok) {
                    setActionMsg(r.error ?? "无法用系统应用打开该文件。");
                  }
                }}
                packExportEnabled={edition.features.acceptancePackExport}
                onDownloadPack={() => void downloadAcceptancePack()}
                packBusy={packBusy}
                revisionDispatchNote={revisionDispatchNote}
                onRevisionDispatchNoteChange={setRevisionDispatchNote}
                revisionDispatchBusy={revisionDispatchBusy}
                onSubmitRevisionJob={() => void submitRevisionJob()}
                actionMsg={actionMsg}
                note={note}
                onNoteChange={setNote}
                paneClassName={reviewPaneClassName("lm-review-meta-pane", "meta")}
                paneStyle={reviewPaneLayoutStyle("meta")}
              />
            ) : null}

            {paneVisibility.meta
              ? renderReviewSplit("meta", onReviewMetaResize, "调整侧栏宽度")
              : null}

            <ReviewWorkbenchDocumentColumn
              apiBase={apiBase}
              detail={detail}
              editorValue={editorValue}
              savedEditorValue={savedEditorValue}
              editorDirty={editorDirty}
              editorSaving={editorSaving}
              editorSaveError={editorSaveError}
              onEditorChange={setEditorValue}
              onEditorSave={() => void saveDraftContent()}
              onEditorRevert={() => {
                if (savedEditorValue) {
                  setEditorValue(savedEditorValue);
                  setEditorSaveError(null);
                }
              }}
              lastExportPath={lastExportPath}
              paneVisibility={paneVisibility}
              reviewMetaWidth={reviewMetaWidth}
              reviewEditorWidth={reviewEditorWidth}
              onReviewEditorResize={onReviewEditorResize}
              hasDetailPane={hasDetailPane}
              templateOptions={templateOptions}
              renderTemplateId={renderTemplateId}
              onRenderTemplateIdChange={setRenderTemplateId}
              actionBusy={actionBusy}
              onExportWord={() => {
                // 导出始终走 strict 验收门禁；被拦时由服务端 422 + 出稿检查面板呈现。
                void submitRender({ includeProvenance });
              }}
              includeProvenance={includeProvenance}
              onIncludeProvenanceChange={setIncludeProvenance}
              exportReady
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
