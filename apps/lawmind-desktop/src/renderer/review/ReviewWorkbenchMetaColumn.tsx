import type { CSSProperties } from "react";
import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type {
  AcceptanceReport,
  ReasoningReport,
} from "../../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { GateDecision, TaskExecutionState } from "../../../../../src/lawmind/platform/contracts.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/index.ts";
import type { LearningSuggestionRecord } from "../../../../../src/lawmind/learning/suggestion-queue.ts";
import {
  gateDecisionBadgeClass,
  gateDecisionLabel,
} from "../lawmind-gate-display";
import { ALL_REVIEW_LABELS } from "../../../../../src/lawmind/review-labels.ts";
import { LawmindAcceptanceGate } from "../LawmindAcceptanceGate";
import { LawmindCitationBanner } from "../LawmindCitationBanner";
import { LawmindReasoningCollapsible } from "../LawmindReasoningCollapsible";
import { LawmindReviewDeliveryBar } from "../LawmindReviewDeliveryBar";
import { LawmindReviewSelfCheckSummary } from "../LawmindReviewSelfCheckSummary";
import { LawmindMemorySourcesPanel } from "../LawmindMemorySourcesPanel";
import { LawmindRedlinePanel } from "../LawmindRedlinePanel";
import { internalIdsTitle, pathBasename } from "../display-ids";
import { reviewStatusDisplayLabel } from "../lawmind-review-display";
import { executionStateLabel } from "./review-workbench-helpers";

export type ReviewWorkbenchMetaColumnProps = {
  apiBase: string;
  assistantId: string;
  detail: ArtifactDraft;
  selectedTaskId: string;
  acceptance: AcceptanceReport | null;
  reasoningReport?: ReasoningReport | null;
  /** Serialized LegalReasoningGraph markdown (read-only contention board). */
  reasoningMarkdown?: string | null;
  citationIntegrity: DraftCitationIntegrityView | null;
  /** Firm+ hard-blocks export on citation issues; Solo advisory. */
  citationGateStrict?: boolean;
  gateDecisions: GateDecision[];
  executionState: TaskExecutionState | null;
  memorySources: MemorySourceLayer[] | null;
  learningQueue: LearningSuggestionRecord[];
  learningBusy: string | null;
  onAdoptSuggestion: (id: string) => void;
  onDismissSuggestion: (id: string) => void;
  onDraftUpdated: () => void;
  onGoToChat?: (opts: { taskId: string; matterId?: string; prompt?: string }) => void;
  deferMemoryWrites: boolean;
  onDeferMemoryWritesChange: (checked: boolean) => void;
  selectedLabels: Set<string>;
  onSelectedLabelsChange: (labels: Set<string>) => void;
  appendToProfile: boolean;
  onAppendToProfileChange: (checked: boolean) => void;
  appendToLawyerProfile: boolean;
  onAppendToLawyerProfileChange: (checked: boolean) => void;
  actionBusy: boolean;
  templateOptions: Array<{ id: string; label: string; kind: "built-in" | "uploaded" }>;
  renderTemplateId: string;
  onRenderTemplateIdChange: (id: string) => void;
  lastExportPath: string | null;
  onApprove: () => void;
  onReject: () => void;
  onModify: () => void;
  onReopen: () => void;
  onExportWord: (opts?: { strict?: boolean }) => void;
  onExportTrackedWord: () => void;
  onShowArtifact?: (outputPath: string) => void;
  /** Open exported docx with system Word/WPS when Electron bridge is available. */
  onOpenWithSystem?: (outputPath: string) => void | Promise<void>;
  packExportEnabled: boolean;
  onDownloadPack: () => void;
  packBusy: boolean;
  revisionDispatchNote: string;
  onRevisionDispatchNoteChange: (value: string) => void;
  revisionDispatchBusy: boolean;
  onSubmitRevisionJob: () => void;
  actionMsg: string | null;
  note: string;
  onNoteChange: (value: string) => void;
  paneClassName: string;
  paneStyle: CSSProperties;
};

export function ReviewWorkbenchMetaColumn(props: ReviewWorkbenchMetaColumnProps) {
  const {
    apiBase,
    assistantId,
    detail,
    selectedTaskId,
    acceptance,
    reasoningReport = null,
    reasoningMarkdown = null,
    citationIntegrity,
    citationGateStrict,
    gateDecisions,
    executionState,
    memorySources,
    learningQueue,
    learningBusy,
    onAdoptSuggestion,
    onDismissSuggestion,
    onDraftUpdated,
    onGoToChat,
    deferMemoryWrites,
    onDeferMemoryWritesChange,
    selectedLabels,
    onSelectedLabelsChange,
    appendToProfile,
    onAppendToProfileChange,
    appendToLawyerProfile,
    onAppendToLawyerProfileChange,
    actionBusy,
    templateOptions,
    renderTemplateId,
    onRenderTemplateIdChange,
    lastExportPath,
    onApprove,
    onReject,
    onModify,
    onReopen,
    onExportWord,
    onExportTrackedWord,
    onShowArtifact,
    onOpenWithSystem,
    packExportEnabled,
    onDownloadPack,
    packBusy,
    revisionDispatchNote,
    onRevisionDispatchNoteChange,
    revisionDispatchBusy,
    onSubmitRevisionJob,
    actionMsg,
    note,
    onNoteChange,
    paneClassName,
    paneStyle,
  } = props;

  const reviewPending = (detail.reviewStatus ?? "pending") === "pending";

  return (
    <div className={paneClassName} style={paneStyle}>
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
        <div className="lm-callout lm-callout-muted" role="status">
          <p className="lm-callout-title">责任与交付权限</p>
          <p className="lm-callout-body">
            产出 Agent：{assistantId || "未记录"} · 复核人：
            {detail.reviewedBy?.trim() || "待执业律师确认"} · 对外交付：
            {detail.reviewStatus === "approved"
              ? `已由 ${detail.reviewedBy?.trim() || "律师"} 批准`
              : "未授权"}
          </p>
          {detail.reviewStatus !== "approved" ? (
            <p className="lm-meta">生成或渲染不等于批准；未完成律师签批前不得作为定稿对外发送。</p>
          ) : null}
        </div>
        <div id="lm-review-citation-banner">
          <LawmindCitationBanner
            view={citationIntegrity}
            apiBase={apiBase}
            taskId={selectedTaskId}
            citationGateStrict={citationGateStrict}
          />
        </div>
        <LawmindRedlinePanel apiBase={apiBase} taskId={selectedTaskId} onDraftUpdated={onDraftUpdated} />
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
                    onClick={() => onAdoptSuggestion(s.id)}
                  >
                    采纳写回
                  </button>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-btn-small"
                    disabled={learningBusy === s.id}
                    onClick={() => onDismissSuggestion(s.id)}
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
        {reasoningMarkdown?.trim() ? (
          <>
            <LawmindReasoningCollapsible
              markdown={reasoningMarkdown}
              variant="workbench"
              defaultOpen={false}
              title="法律推理图（只读争点）"
            />
            <p className="lm-meta">
              争点板只读；编辑请回对话修订或更新 CASE.md。可编辑争点 API 尚未开放。
            </p>
          </>
        ) : null}
        <LawmindAcceptanceGate
          report={acceptance}
          reasoning={reasoningReport}
          defaultCollapsed
          onGoFillInChat={
            onGoToChat
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
            onChange={(e) => onDeferMemoryWritesChange(e.target.checked)}
            disabled={actionBusy || !reviewPending}
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
                  disabled={actionBusy || !reviewPending}
                  onChange={() => {
                    const next = new Set(selectedLabels);
                    if (next.has(lb)) {
                      next.delete(lb);
                    } else {
                      next.add(lb);
                    }
                    onSelectedLabelsChange(next);
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
            disabled={deferMemoryWrites || actionBusy || !reviewPending}
            onChange={(e) => onAppendToProfileChange(e.target.checked)}
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
            disabled={deferMemoryWrites || actionBusy || !reviewPending}
            onChange={(e) => onAppendToLawyerProfileChange(e.target.checked)}
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
            {!reviewPending ? (
              <p className="lm-meta lm-review-signoff-locked">
                状态「{reviewStatusDisplayLabel(detail.reviewStatus)}」：需重审时请先恢复为待审核。
              </p>
            ) : null}
            {templateOptions.length > 0 ? (
              <label className="lm-review-template-pick">
                <span>交付模板</span>
                <select
                  value={renderTemplateId}
                  onChange={(e) => onRenderTemplateIdChange(e.target.value)}
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
          onApprove={onApprove}
          onReject={onReject}
          onModify={onModify}
          onReopen={onReopen}
          onExportWord={onExportWord}
          onExportTrackedWord={onExportTrackedWord}
          onShowInFolder={onShowArtifact}
          onOpenWithSystem={onOpenWithSystem}
          packExportEnabled={packExportEnabled}
          onDownloadPack={onDownloadPack}
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
                onChange={(e) => onRevisionDispatchNoteChange(e.target.value)}
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
                onClick={onSubmitRevisionJob}
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
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                onClick={() => onShowArtifact(detail.outputPath!)}
              >
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
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="例如：须补充××条款依据、与当事人核实××事实后再定稿…"
            rows={4}
            disabled={actionBusy || !reviewPending}
            aria-disabled={actionBusy || !reviewPending}
          />
        </label>
      </div>
    </div>
  );
}
