/**
 * 草稿审核台 — 列表、全文审阅、通过 / 驳回 / 备注、批准后渲染交付物。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { ALL_REVIEW_LABELS } from "../../../../src/lawmind/review-labels.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { LearningSuggestionRecord } from "../../../../src/lawmind/learning/suggestion-queue.ts";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { LawmindReasoningCollapsible } from "./LawmindReasoningCollapsible";

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
  /** 打开工作区产物目录（Electron） */
  onShowArtifact?: (outputPath: string) => void;
  /** 审核或渲染成功后刷新侧栏任务列表 */
  onRecordsChanged?: () => void;
};

function renderInlineSections(draft: ArtifactDraft): ReactNode {
  return draft.sections.map((s, i) => (
    <section key={i} className="lm-draft-section">
      <h4>{s.heading}</h4>
      <div className="lm-draft-body">{s.body}</div>
    </section>
  ));
}

function reviewStatusFilterLabel(status: ArtifactDraft["reviewStatus"] | "all"): string {
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

export function ReviewWorkbench(props: Props) {
  const {
    apiBase,
    assistantId = "default",
    initialTaskId = null,
    initialMatterId = null,
    initialStatusFilter = "all",
    initialListMode = "pending",
    onShowArtifact,
    onRecordsChanged,
  } = props;
  const [drafts, setDrafts] = useState<ArtifactDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [statusFilter, setStatusFilter] = useState<ArtifactDraft["reviewStatus"] | "all">("all");
  const [matterFilter, setMatterFilter] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtifactDraft | null>(null);
  const [citationIntegrity, setCitationIntegrity] = useState<DraftCitationIntegrityView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [appendToProfile, setAppendToProfile] = useState(false);
  const [appendToLawyerProfile, setAppendToLawyerProfile] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [deferMemoryWrites, setDeferMemoryWrites] = useState(false);
  const [reasoningMarkdown, setReasoningMarkdown] = useState<string | null>(null);
  const [memorySources, setMemorySources] = useState<MemorySourceLayer[] | null>(null);
  const [learningQueue, setLearningQueue] = useState<LearningSuggestionRecord[]>([]);
  const [learningBusy, setLearningBusy] = useState<string | null>(null);

  const loadLearningQueue = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/api/learning/suggestions`);
      const j = (await r.json()) as { ok?: boolean; suggestions?: LearningSuggestionRecord[] };
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

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/drafts`);
      const j = (await r.json()) as { ok?: boolean; drafts?: ArtifactDraft[] };
      if (!j.ok || !Array.isArray(j.drafts)) {
        throw new Error("加载草稿列表失败");
      }
      setDrafts(j.drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
    async (taskId: string) => {
      setDetailLoading(true);
      setDetail(null);
      setCitationIntegrity(null);
      setActionMsg(null);
      try {
        const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(taskId)}`);
        const j = (await r.json()) as {
          ok?: boolean;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
          reasoningMarkdown?: string | null;
          memorySources?: MemorySourceLayer[];
        };
        if (!r.ok || !j.ok || !j.draft) {
          throw new Error("加载草稿失败");
        }
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setReasoningMarkdown(typeof j.reasoningMarkdown === "string" ? j.reasoningMarkdown : null);
        setMemorySources(Array.isArray(j.memorySources) ? j.memorySources : null);
      } catch (e) {
        setActionMsg(e instanceof Error ? e.message : String(e));
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    if (selectedTaskId) {
      void loadDetail(selectedTaskId);
    } else {
      setDetail(null);
      setCitationIntegrity(null);
      setReasoningMarkdown(null);
      setMemorySources(null);
    }
  }, [selectedTaskId, loadDetail]);

  const filtered = useMemo(() => {
    return drafts.filter((draft) => {
      if (filter === "pending" && draft.reviewStatus !== "pending") {
        return false;
      }
      if (statusFilter !== "all" && draft.reviewStatus !== statusFilter) {
        return false;
      }
      if (matterFilter.trim() && draft.matterId !== matterFilter.trim()) {
        return false;
      }
      return true;
    });
  }, [drafts, filter, matterFilter, statusFilter]);

  const submitReview = async (status: "approved" | "rejected" | "modified") => {
    if (!selectedTaskId) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const labels = Array.from(selectedLabels);
      const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(selectedTaskId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          status,
          note: note.trim() || undefined,
          appendToProfile: deferMemoryWrites ? false : appendToProfile,
          appendToLawyerProfile: deferMemoryWrites ? false : appendToLawyerProfile,
          profileAssistantId: assistantId,
          ...(labels.length > 0 ? { labels } : {}),
          ...(deferMemoryWrites ? { deferMemoryWrites: true } : {}),
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        draft?: ArtifactDraft;
        citationIntegrity?: DraftCitationIntegrityView;
      };
      if (!r.ok || !j.ok) {
        const extra =
          (j as { profileAppendFailed?: boolean; lawyerProfileAppendFailed?: boolean })
            .lawyerProfileAppendFailed
            ? "（律师档案未写入，草稿状态已保存）"
            : (j as { profileAppendFailed?: boolean }).profileAppendFailed
              ? "（助手档案未写入，草稿状态已保存）"
              : "";
        throw new Error((j.error ?? "审核失败") + extra);
      }
      setNote("");
      setSelectedLabels(new Set());
      setDeferMemoryWrites(false);
      setActionMsg(status === "approved" ? "已通过审核。可点击「渲染交付物」生成文件。" : "已记录审核结果。");
      await loadDrafts();
      void loadLearningQueue();
      if (j.draft) {
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
      }
      onRecordsChanged?.();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const adoptSuggestion = async (id: string) => {
    setLearningBusy(id);
    try {
      const r = await fetch(`${apiBase}/api/learning/suggestions/${encodeURIComponent(id)}/adopt`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "采纳失败");
      }
      await loadLearningQueue();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLearningBusy(null);
    }
  };

  const dismissSuggestion = async (id: string) => {
    setLearningBusy(id);
    try {
      const r = await fetch(`${apiBase}/api/learning/suggestions/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "忽略失败");
      }
      await loadLearningQueue();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLearningBusy(null);
    }
  };

  const submitRender = async () => {
    if (!selectedTaskId) {
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const r = await fetch(`${apiBase}/api/drafts/${encodeURIComponent(selectedTaskId)}/render`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        error?: string;
        outputPath?: string;
      };
      if (!r.ok || !j.ok) {
        throw new Error(j.error ?? "渲染失败");
      }
      setActionMsg(`已生成：${j.outputPath ?? ""}`);
      await loadDrafts();
      if (j.outputPath && onShowArtifact) {
        onShowArtifact(j.outputPath);
      }
      onRecordsChanged?.();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="lm-workbench lm-review-workbench">
      <div className="lm-workbench-list">
        <div className="lm-workbench-list-header">
          <h2>草稿审核</h2>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadDrafts()}>
            刷新
          </button>
        </div>
        <div className="lm-review-filters">
          <button
            type="button"
            className={`lm-tab ${filter === "pending" ? "active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            待审核
          </button>
          <button
            type="button"
            className={`lm-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            全部
          </button>
        </div>
        <div className="lm-review-scope">
          <label className="lm-field lm-review-scope-field">
            <span>状态</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ArtifactDraft["reviewStatus"] | "all")}
            >
              <option value="all">全部状态</option>
              <option value="pending">待审核</option>
              <option value="modified">需修改</option>
              <option value="approved">已通过</option>
              <option value="rejected">已驳回</option>
            </select>
          </label>
          <label className="lm-field lm-review-scope-field">
            <span>案件范围</span>
            <input
              type="text"
              value={matterFilter}
              onChange={(e) => setMatterFilter(e.target.value)}
              placeholder="全部案件"
            />
          </label>
        </div>
        {(matterFilter.trim() || statusFilter !== "all") && (
          <div className="lm-review-scope-hint">
            <span className="lm-meta">
              当前范围：{matterFilter.trim() ? `案件 ${matterFilter.trim()}` : "全部案件"} ·{" "}
              {reviewStatusFilterLabel(statusFilter)}
            </span>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-small"
              onClick={() => {
                setMatterFilter("");
                setStatusFilter("all");
              }}
            >
              清空范围
            </button>
          </div>
        )}
        {loading && <div className="lm-meta">加载中…</div>}
        {error && <div className="lm-error">{error}</div>}
        {!loading && filtered.length === 0 && (
          <div className="lm-meta lm-workbench-empty">
            {matterFilter.trim() || statusFilter !== "all"
              ? "当前范围内暂无草稿。"
              : filter === "pending"
                ? "暂无待审核草稿。"
                : "暂无草稿记录。"}
          </div>
        )}
        <ul className="lm-workbench-draft-list">
          {filtered.map((d) => (
            <li key={d.taskId}>
              <button
                type="button"
                className={`lm-draft-row ${selectedTaskId === d.taskId ? "active" : ""}`}
                onClick={() => setSelectedTaskId(d.taskId)}
              >
                <span className="lm-draft-title">{d.title}</span>
                <span className={`lm-badge lm-draft-status-${d.reviewStatus}`}>{d.reviewStatus}</span>
                {d.matterId && <span className="lm-matter-badge">{d.matterId}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="lm-workbench-main">
        {!selectedTaskId && (
          <div className="lm-meta lm-workbench-placeholder">选择左侧草稿进行审阅与签批</div>
        )}
        {selectedTaskId && detailLoading && <div className="lm-meta">加载草稿…</div>}
        {selectedTaskId && !detailLoading && detail && (
          <>
            <LawmindCitationBanner view={citationIntegrity} />
            {learningQueue.length > 0 && (
              <div className="lm-review-learning-queue">
                <div className="lm-review-learning-queue-header">
                  <strong>学习队列</strong>
                  <span className="lm-meta">{learningQueue.length} 条待采纳</span>
                </div>
                <ul className="lm-review-learning-list">
                  {learningQueue.slice(0, 8).map((s) => (
                    <li key={s.id}>
                      <span className="lm-meta">
                        {s.taskId.slice(0, 8)}… · {s.labels.join(", ") || "（无标签）"}
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
            {reasoningMarkdown ? (
              <LawmindReasoningCollapsible markdown={reasoningMarkdown} variant="workbench" />
            ) : null}
            {memorySources && memorySources.length > 0 ? (
              <LawmindMemorySourcesPanel layers={memorySources} variant="workbench" />
            ) : null}
            <div className="lm-workbench-toolbar">
              <div>
                <h2>{detail.title}</h2>
                <p className="lm-meta">
                  任务 {detail.taskId} · 输出 {detail.output} · 模板 {detail.templateId}
                  {detail.matterId ? ` · 案件 ${detail.matterId}` : ""}
                </p>
              </div>
              <div className="lm-review-actions">
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("rejected")}
                >
                  驳回
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("modified")}
                >
                  需修改
                </button>
                <button
                  type="button"
                  className="lm-btn"
                  disabled={actionBusy || detail.reviewStatus !== "pending"}
                  onClick={() => void submitReview("approved")}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-accent"
                  disabled={actionBusy || detail.reviewStatus !== "approved"}
                  onClick={() => void submitRender()}
                >
                  渲染交付物
                </button>
              </div>
            </div>

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
              />
              <span>
                结构化标签先入<strong>学习队列</strong>（暂不写入 PROFILE / Playbook，稍后在上方队列点「采纳写回」）
              </span>
            </label>
            <div className="lm-review-labels">
              <span className="lm-review-labels-title">审核标签（可选，驱动质量学习）</span>
              <div className="lm-review-labels-grid">
                {ALL_REVIEW_LABELS.map((lb) => (
                  <label key={lb} className="lm-review-label-chip">
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(lb)}
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
                disabled={deferMemoryWrites}
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
                disabled={deferMemoryWrites}
                onChange={(e) => setAppendToLawyerProfile(e.target.checked)}
              />
              <span>
                将本条审核摘要记入工作区律师档案「八、个人积累」（<code>LAWYER_PROFILE.md</code>）
              </span>
            </label>
            <label className="lm-field lm-review-note">
              <span>审核备注（可选）</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="驳回或修改时请说明理由，将写入审计与案件档案。"
                rows={3}
              />
            </label>
            {actionMsg && <div className="lm-meta lm-review-msg">{actionMsg}</div>}
            {detail.outputPath && (
              <div className="lm-meta">
                已有交付路径：{detail.outputPath}{" "}
                {onShowArtifact && (
                  <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onShowArtifact(detail.outputPath!)}>
                    在文件夹中显示
                  </button>
                )}
              </div>
            )}

            <div className="lm-draft-preview">{renderInlineSections(detail)}</div>
          </>
        )}
      </div>
    </div>
  );
}
