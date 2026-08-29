import type { ArtifactDraft } from "../../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../../src/lawmind/drafts/citation-integrity.ts";
import type { MemorySourceLayer } from "../../../../../src/lawmind/memory/index.ts";
import { LawmindMemorySourcesPanel } from "../LawmindMemorySourcesPanel";
import { LawmindReasoningCollapsible } from "../LawmindReasoningCollapsible";
import { internalIdsTitle } from "../display-ids";
import type { ReasoningReport } from "../../../../../src/lawmind/deliverables/index.ts";
import { MatterMemoryInspector } from "./MatterMemoryInspector";
import { MatterReasoningBoard } from "./MatterReasoningBoard";
import { DraftCitationBadge } from "./matter-draft-citation-badge";
import { formatShortDateTime, reviewStatusLabel } from "./matter-display-labels.js";
import {
  type AdoptionHistoryInsight,
  type AdoptedSuggestionRecord,
  type MatterCognitionBoard,
} from "./matter-interaction";

export type MatterCognitionPanelProps = {
  apiBase: string;
  matterId: string;
  drafts: ArtifactDraft[];
  cognitionTaskId: string | null;
  setCognitionTaskId: (id: string | null) => void;
  cognitionDraft: ArtifactDraft | null;
  cognitionBoardLoading: boolean;
  cognitionBoardError: string | null;
  cognitionBoard: MatterCognitionBoard | null;
  cognitionLoading: boolean;
  cognitionError: string | null;
  cognitionReasoningMarkdown: string | null;
  cognitionMemorySources: MemorySourceLayer[];
  cognitionActionBusy: string | null;
  cognitionActionMsg: string | null;
  draftCitationByTask: Record<string, DraftCitationIntegrityView>;
  adoptionHistoryInsight: AdoptionHistoryInsight;
  visiblePersistentAdoptions: AdoptedSuggestionRecord[];
  adoptedSuggestions: AdoptedSuggestionRecord[];
  saveUpgradeSuggestion: (
    target: "lawyer" | "assistant",
    item: { label: string; recommendation: string; count: number },
  ) => Promise<void>;
  onOpenReview?: (target: {
    taskId: string;
    matterId?: string;
    statusFilter?: ArtifactDraft["reviewStatus"] | "all";
    listMode?: "pending" | "all";
  }) => void;
  openReviewFromMatter: (
    taskId: string,
    opts?: {
      matterId?: string;
      statusFilter?: ArtifactDraft["reviewStatus"] | "all";
      listMode?: "pending" | "all";
      sourceSurface?: string;
      sourceLabel?: string;
    },
  ) => void;
  reasoningReport?: ReasoningReport | null;
};

export function MatterCognitionPanel(props: MatterCognitionPanelProps) {
  const {
    drafts,
    cognitionTaskId,
    setCognitionTaskId,
    cognitionBoardLoading,
    cognitionBoardError,
    cognitionBoard,
    cognitionLoading,
    cognitionError,
    cognitionReasoningMarkdown,
    cognitionMemorySources,
    cognitionDraft,
    cognitionActionBusy,
    cognitionActionMsg,
    draftCitationByTask,
    adoptionHistoryInsight,
    visiblePersistentAdoptions,
    adoptedSuggestions,
    saveUpgradeSuggestion,
    onOpenReview,
    openReviewFromMatter,
    apiBase,
    matterId,
    reasoningReport = null,
  } = props;

  return (
    <div className="lm-workbench-panel">
      <section className="lm-matter-cockpit-card lm-matter-cognition-card">
        <div className="lm-matter-cognition-head">
          <div>
            <h3>经验</h3>
          </div>
          <label className="lm-field lm-matter-cognition-select">
            <span>观察草稿</span>
            <select
              value={cognitionTaskId ?? ""}
              onChange={(e) => setCognitionTaskId(e.target.value || null)}
              disabled={drafts.length === 0}
            >
              {drafts.length === 0 ? (
                <option value="">暂无草稿</option>
              ) : (
                drafts.map((draft) => (
                  <option key={draft.taskId} value={draft.taskId}>
                    {reviewStatusLabel(draft.reviewStatus)} · {draft.title}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>
         {cognitionBoardLoading ? <div className="lm-meta">…</div> : null}
        {cognitionBoardError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{cognitionBoardError}</p>
          </div>
        ) : null}
        {cognitionBoard ? (
          <div className="lm-matter-cognition-board">
            <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
              <div className="lm-matter-summary-top">
                <span className="lm-matter-summary-title">观察草稿</span>
                <span className="lm-matter-summary-count">{cognitionBoard.observedDraftCount}</span>
              </div>
            </div>
            <div className="lm-matter-summary-card lm-matter-summary-card-info">
              <div className="lm-matter-summary-top">
                <span className="lm-matter-summary-title">推理快照</span>
                <span className="lm-matter-summary-count">{cognitionBoard.reasoningDraftCount}</span>
              </div>
            </div>
            <div className="lm-matter-summary-card lm-matter-summary-card-warn">
              <div className="lm-matter-summary-top">
                <span className="lm-matter-summary-title">记忆层</span>
                <span className="lm-matter-summary-count">{cognitionBoard.uniqueMemoryLayerCount}</span>
              </div>
            </div>
            <div className="lm-matter-summary-card lm-matter-summary-card-success">
              <div className="lm-matter-summary-top">
                <span className="lm-matter-summary-title">已注入</span>
                <span className="lm-matter-summary-count">{cognitionBoard.injectedMemoryLayerCount}</span>
              </div>
            </div>
          </div>
        ) : null}
         {cognitionBoard ? (
          <div className="lm-matter-cognition-grid">
            <section className="lm-matter-cockpit-card">
              <h3>认知风险信号</h3>
              <ul className="lm-bullet-list">
                <li>缺推理快照草稿：{cognitionBoard.missingReasoningCount}</li>
                <li>引用待核或无快照草稿：{cognitionBoard.missingCitationCount}</li>
                <li>高频但未注入提示的记忆层：{cognitionBoard.uncoveredFrequentLayerCount}</li>
                <li>
                  采样时间跨度：{formatShortDateTime(cognitionBoard.oldestDraftAt)} 至{" "}
                  {formatShortDateTime(cognitionBoard.newestDraftAt)}
                </li>
              </ul>
            </section>
            <section className="lm-matter-cockpit-card">
              <h3>记忆层分层</h3>
              <div className="lm-matter-memory-category-grid">
                {cognitionBoard.memoryCategories.map((category) => (
                  <div key={category.key} className="lm-matter-memory-category">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">{category.title}</span>
                      <span className="lm-matter-summary-count">{category.count}</span>
                    </div>
                  </div>
                ))}
              </div>
              {cognitionBoard.missingMemoryLayers.length > 0 ? (
                <ul className="lm-matter-ops-list lm-matter-memory-missing-list">
                  {cognitionBoard.missingMemoryLayers.map((layer) => (
                    <li key={layer.label}>
                      <div className="lm-matter-ops-title">
                        <span>{layer.label}</span>
                        <span className="lm-matter-pill">{layer.count} 次缺失</span>
                      </div>
                      <div className="lm-matter-ops-meta">预期文件缺失</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="lm-meta">无</p>
              )}
            </section>
            <section className="lm-matter-cockpit-card">
              <h3>经验升级线索</h3>
              <p className="lm-meta">建议确认后才入库。</p>
              {cognitionBoard.upgradeSuggestions.length === 0 ? (
                <p className="lm-meta">无</p>
              ) : (
                <ul className="lm-matter-ops-list">
                  {cognitionBoard.upgradeSuggestions.map((item) => (
                    <li key={item.label}>
                      <div className="lm-matter-ops-title">
                        <span>{item.label}</span>
                        <span className="lm-matter-pill">{item.count} 次命中</span>
                      </div>
                      <div className="lm-matter-ops-meta">{item.recommendation}</div>
                      <div className="lm-matter-ops-actions lm-matter-upgrade-actions">
                        <button
                          type="button"
                          className="lm-btn lm-btn-secondary lm-btn-small"
                          disabled={cognitionActionBusy === `lawyer:${item.label}`}
                          onClick={() => void saveUpgradeSuggestion("lawyer", item)}
                        >
                          加入律师档案队列
                        </button>
                        <button
                          type="button"
                          className="lm-btn lm-btn-secondary lm-btn-small"
                          disabled={cognitionActionBusy === `assistant:${item.label}`}
                          onClick={() => void saveUpgradeSuggestion("assistant", item)}
                        >
                          加入助手档案队列
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {cognitionActionMsg ? <div className="lm-meta lm-matter-action-msg">{cognitionActionMsg}</div> : null}
            </section>
            <section className="lm-matter-cockpit-card">
              <h3>已采纳建议</h3>
              {visiblePersistentAdoptions.length > 0 ? (
                <div className="lm-matter-cognition-board lm-matter-adoption-board">
                  <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">持久记录</span>
                      <span className="lm-matter-summary-count">{adoptionHistoryInsight.total}</span>
                    </div>
                  </div>
                  <div className="lm-matter-summary-card lm-matter-summary-card-info">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">律师档案</span>
                      <span className="lm-matter-summary-count">{adoptionHistoryInsight.lawyerCount}</span>
                    </div>
                  </div>
                  <div className="lm-matter-summary-card lm-matter-summary-card-success">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">助手档案</span>
                      <span className="lm-matter-summary-count">{adoptionHistoryInsight.assistantCount}</span>
                    </div>
                  </div>
                  <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">覆盖案件</span>
                      <span className="lm-matter-summary-count">{adoptionHistoryInsight.crossMatterCount}</span>
                    </div>
                  </div>
                  <div className="lm-matter-summary-card lm-matter-summary-card-warn">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">重复采纳</span>
                      <span className="lm-matter-summary-count">{adoptionHistoryInsight.repeatedLabels.length}</span>
                    </div>
                  </div>
                  <div className="lm-matter-summary-card lm-matter-summary-card-neutral">
                    <div className="lm-matter-summary-top">
                      <span className="lm-matter-summary-title">最近采纳</span>
                      <span className="lm-matter-summary-count">
                        {adoptionHistoryInsight.latestSavedAt
                          ? formatShortDateTime(adoptionHistoryInsight.latestSavedAt)
                          : "--"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
              {visiblePersistentAdoptions.length === 0 && adoptedSuggestions.length === 0 ? (
                <p className="lm-meta">无</p>
              ) : (
                <>
                  {adoptionHistoryInsight.repeatedLabels.length > 0 ? (
                    <div className="lm-matter-cockpit-card lm-matter-adoption-repeat-card">
                      <h3>复用信号</h3>
                      <ul className="lm-matter-ops-list">
                        {adoptionHistoryInsight.repeatedLabels.map((item) => (
                          <li key={item.label}>
                            <div className="lm-matter-ops-title">
                              <span>{item.label}</span>
                              <span className="lm-matter-pill">{item.count} 次采纳</span>
                            </div>
                            <div
                              className="lm-matter-ops-meta"
                              title={
                                item.matterIds.length > 0 ? item.matterIds.join("、") : undefined
                              }
                            >
                              {item.latestSavedAt ? formatShortDateTime(item.latestSavedAt) : "—"}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {visiblePersistentAdoptions.length > 0 ? (
                    <>
                      <div className="lm-meta lm-matter-history-title">持久历史</div>
                      <ul className="lm-matter-ops-list">
                        {visiblePersistentAdoptions.map((item) => (
                          <li
                            key={item.key}
                            title={internalIdsTitle([
                              { label: "案件编号", value: item.matterId ?? undefined },
                              { label: "任务编号", value: item.taskId ?? undefined },
                            ])}
                          >
                            <div className="lm-matter-ops-title">
                              <span>{item.label}</span>
                              <span className="lm-matter-pill">
                                {item.target === "lawyer" ? "律师档案" : "助手档案"}
                              </span>
                            </div>
                            <div className="lm-matter-ops-meta">
                              {item.matterId ? "已关联到案件工作台" : "案件未记录"}
                              {item.draftTitle ? ` · 草稿《${item.draftTitle}》` : ""}
                            </div>
                            <div className="lm-matter-ops-meta">采纳时间：{formatShortDateTime(item.savedAt)}</div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {adoptedSuggestions.length > 0 ? (
                    <>
                      <div className="lm-meta lm-matter-history-title">本次会话新增</div>
                      <ul className="lm-matter-ops-list">
                        {adoptedSuggestions.map((item) => (
                          <li
                            key={item.key}
                            title={internalIdsTitle([
                              { label: "案件编号", value: item.matterId ?? undefined },
                              { label: "任务编号", value: item.taskId ?? undefined },
                            ])}
                          >
                            <div className="lm-matter-ops-title">
                              <span>{item.label}</span>
                              <span className="lm-matter-pill">
                                {item.target === "lawyer" ? "律师档案" : "助手档案"}
                              </span>
                            </div>
                            <div className="lm-matter-ops-meta">
                              {item.matterId ? "已关联到案件工作台" : "案件未记录"}
                              {item.draftTitle ? ` · 草稿《${item.draftTitle}》` : ""}
                            </div>
                            <div className="lm-matter-ops-meta">采纳时间：{formatShortDateTime(item.savedAt)}</div>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </>
              )}
            </section>
            <section className="lm-matter-cockpit-card">
              <h3>高频记忆层</h3>
              {cognitionBoard.topMemoryLayers.length === 0 ? (
                <p className="lm-meta">无</p>
              ) : (
                <ul className="lm-matter-ops-list">
                  {cognitionBoard.topMemoryLayers.map((layer) => (
                    <li key={layer.label}>
                      <div className="lm-matter-ops-title">
                        <span>{layer.label}</span>
                        <div className="lm-matter-ops-actions">
                          <span className="lm-matter-pill">{layer.count} 份草稿</span>
                          <span className={`lm-matter-pill ${layer.injected ? "lm-matter-pill-status-approved" : ""}`}>
                            {layer.injected ? "已注入" : "仅检索"}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="lm-matter-cockpit-card">
              <h3>推理覆盖</h3>
              <ul className="lm-matter-ops-list">
                {cognitionBoard.draftCoverage.map((item) => (
                  <li
                    key={item.taskId}
                    title={internalIdsTitle([{ label: "任务编号", value: item.taskId }])}
                  >
                    <div className="lm-matter-ops-title">
                      <span>{item.title}</span>
                      <div className="lm-matter-ops-actions">
                        <span className={`lm-matter-pill lm-matter-pill-status-${item.status}`}>
                          {reviewStatusLabel(item.status)}
                        </span>
                        <span className={`lm-matter-pill ${item.hasReasoning ? "lm-matter-pill-status-approved" : ""}`}>
                          {item.hasReasoning ? "有推理" : "无快照"}
                        </span>
                      </div>
                    </div>
                    <div className="lm-matter-ops-meta">
                      记忆层 {item.memoryLayerCount} · 草稿创建 {formatShortDateTime(item.createdAt)}
                    </div>
                    <div className="lm-matter-ops-meta">
                      {item.hasReasoning ? "推理已留痕" : "推理缺快照"} ·{" "}
                      {item.citationState === "ok"
                        ? "引用已核对"
                        : item.citationState === "warn"
                          ? "引用待核"
                          : "无检索快照"}{" "}
                      · {formatShortDateTime(item.createdAt)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
         {cognitionDraft && (
          <div className="lm-matter-cognition-meta">
            <span className={`lm-matter-pill lm-matter-pill-status-${cognitionDraft.reviewStatus}`}>
              {reviewStatusLabel(cognitionDraft.reviewStatus)}
            </span>
            <span
              className="lm-meta"
              title={cognitionDraft.templateId ? `模板编号：${cognitionDraft.templateId}` : undefined}
            >
              {cognitionDraft.templateId ? "已绑定交付模板" : "未指定模板"}
            </span>
            <span className="lm-meta">创建于 {cognitionDraft.createdAt}</span>
            <DraftCitationBadge cit={draftCitationByTask[cognitionDraft.taskId]} />
            {onOpenReview ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                onClick={() =>
                  openReviewFromMatter(cognitionDraft.taskId, {
                    matterId: cognitionDraft.matterId,
                    statusFilter: cognitionDraft.reviewStatus,
                    listMode: cognitionDraft.reviewStatus === "pending" ? "pending" : "all",
                    sourceSurface: "cognition",
                    sourceLabel: cognitionDraft.title,
                  })
                }
              >
                改稿
              </button>
            ) : null}
          </div>
        )}
         {cognitionError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{cognitionError}</p>
          </div>
        ) : null}
        {cognitionLoading ? <div className="lm-meta">加载认知面板…</div> : null}
        {!cognitionLoading && !cognitionDraft ? (
          <div className="lm-meta">无草稿</div>
        ) : null}
        {!cognitionLoading && cognitionDraft ? (
          <div className="lm-matter-cognition-panels">
            <LawmindMemorySourcesPanel
              layers={cognitionMemorySources}
              variant="workbench"
              defaultOpen
            />
            {cognitionReasoningMarkdown ? (
              <LawmindReasoningCollapsible
                markdown={cognitionReasoningMarkdown}
                variant="workbench"
                defaultOpen
                title="当前案件推理快照"
              />
            ) : null}
            <MatterReasoningBoard matterId={matterId} reasoning={reasoningReport} />
            <section className="lm-matter-cockpit-card lm-matter-memory-inspector-card">
              <h3>记忆采纳队列</h3>
              <p className="lm-meta">预览后采纳。</p>
              <MatterMemoryInspector apiBase={apiBase} matterId={matterId} />
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
