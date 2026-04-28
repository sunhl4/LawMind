/**
 * 草稿审核台 — 列表、全文审阅、通过 / 驳回 / 备注、批准后渲染交付物。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import type { AcceptanceReport } from "../../../../src/lawmind/deliverables/index.ts";
import type { DraftCitationIntegrityView } from "../../../../src/lawmind/drafts/citation-integrity.ts";
import { ALL_REVIEW_LABELS } from "../../../../src/lawmind/review-labels.ts";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import type { LearningSuggestionRecord } from "../../../../src/lawmind/learning/suggestion-queue.ts";
import { LawmindAcceptanceGate } from "./LawmindAcceptanceGate";
import { LawmindCitationBanner } from "./LawmindCitationBanner";
import { LawmindReviewSelfCheckSummary } from "./LawmindReviewSelfCheckSummary";
import { LawmindSourcePillList } from "./LawmindSourcePreview";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { LawmindReasoningCollapsible } from "./LawmindReasoningCollapsible";
import {
  apiGetJson,
  apiSendJson,
  errorMessage,
  messageFromOkFalseBody,
  userMessageFromApiError,
  type ApiErrorJson,
} from "./api-client";
import { useEdition } from "./use-edition";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "./lawmind-panel-layout";
import { usePaneResizePx } from "./use-pane-resize";

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

function renderInlineSections(draft: ArtifactDraft, apiBase?: string): ReactNode {
  return draft.sections.map((s, i) => {
    const citations = (s.citations ?? []).filter(Boolean);
    return (
      <section key={i} className="lm-draft-section">
        <h4>{s.heading}</h4>
        <div className="lm-draft-body">{s.body}</div>
        {citations.length > 0 ? (
          <div className="lm-draft-section-cites">
            <span className="lm-meta">引用：</span>
            <LawmindSourcePillList
              apiBase={apiBase ?? ""}
              taskId={draft.taskId}
              sourceIds={citations}
            />
          </div>
        ) : null}
      </section>
    );
  });
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

/** 列表/详情展示用；缺省视为待审核（旧草稿可能未写 reviewStatus） */
function reviewStatusDisplayLabel(status: ArtifactDraft["reviewStatus"] | undefined): string {
  return reviewStatusFilterLabel(status ?? "pending");
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
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [, setReopenSubmitting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [appendToProfile, setAppendToProfile] = useState(false);
  const [appendToLawyerProfile, setAppendToLawyerProfile] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [deferMemoryWrites, setDeferMemoryWrites] = useState(false);
  const [reasoningMarkdown, setReasoningMarkdown] = useState<string | null>(null);
  const [memorySources, setMemorySources] = useState<MemorySourceLayer[] | null>(null);
  const [learningQueue, setLearningQueue] = useState<LearningSuggestionRecord[]>([]);
  const [learningBusy, setLearningBusy] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  /** 当前输出格式下可选的交付模板（内置 + 已启用上传） */
  const [templateCatalog, setTemplateCatalog] = useState<{
    builtIn: Array<{ id: string; format: string; label: string }>;
    uploaded: Array<{ id: string; format: string; label: string; enabled: boolean }>;
  } | null>(null);
  /** 渲染时使用的 templateId，可与文书草稿上的默认模板不同 */
  const [renderTemplateId, setRenderTemplateId] = useState("");
  const edition = useEdition(apiBase);

  const { width: reviewListWidth, onResizePointerDown: onReviewListResize } = usePaneResizePx({
    storageKey: "lawmind.ui.reviewWorkbenchListWidth",
    defaultWidth: 280,
    min: LM_PANE_MIN_WIDTH_PX,
    max: LM_PANE_MAX_WIDTH_PX,
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

  const loadDrafts = useCallback(async () => {
    setLoading(true);
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
    async (taskId: string) => {
      setDetailLoading(true);
      setDetail(null);
      setCitationIntegrity(null);
      setAcceptance(null);
      setActionMsg(null);
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          draft?: ArtifactDraft;
          citationIntegrity?: DraftCitationIntegrityView;
          reasoningMarkdown?: string | null;
          memorySources?: MemorySourceLayer[];
          acceptance?: AcceptanceReport;
        }>(apiBase, `/api/drafts/${encodeURIComponent(taskId)}`);
        if (!j.ok || !j.draft) {
          throw new Error(messageFromOkFalseBody(j, "加载草稿失败"));
        }
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setReasoningMarkdown(typeof j.reasoningMarkdown === "string" ? j.reasoningMarkdown : null);
        setMemorySources(Array.isArray(j.memorySources) ? j.memorySources : null);
        setAcceptance(j.acceptance ?? null);
      } catch (e) {
        setActionMsg(errorMessage(e, "加载草稿失败"));
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
      setAcceptance(null);
    }
  }, [selectedTaskId, loadDetail]);

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
        },
        Record<string, never>
      >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/reopen-review`, "POST", {});
      if (!j.ok) {
        throw new Error(messageFromOkFalseBody(j, "恢复待审核失败"));
      }
      setActionMsg("已恢复为待审核。可再次使用通过 / 驳回 / 需修改；通过后可用「渲染交付物」。");
      await loadDrafts();
      if (j.draft) {
        setDetail(j.draft);
        setCitationIntegrity(j.citationIntegrity ?? null);
        setAcceptance(j.acceptance ?? null);
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
      let msg = status === "approved" ? "已通过审核。可点击「渲染交付物」生成文件。" : "已记录审核结果。";
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
      }
      onRecordsChanged?.();
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

  const submitRender = async () => {
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
      const j = await apiSendJson<
        {
          ok?: boolean;
          error?: string;
          message?: string;
          outputPath?: string;
          acceptance?: AcceptanceReport;
        },
        { templateId?: string }
      >(apiBase, `/api/drafts/${encodeURIComponent(selectedTaskId)}/render`, "POST", renderBody);
      if (!j.ok) {
        if (j.acceptance) {
          setAcceptance(j.acceptance);
        }
        throw new Error(messageFromOkFalseBody(j, "渲染失败"));
      }
      if (j.acceptance) {
        setAcceptance(j.acceptance);
      }
      setActionMsg(`已生成：${j.outputPath ?? ""}`);
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
      <div className="lm-workbench lm-review-workbench">
      <div className="lm-workbench-list" style={{ width: reviewListWidth, flexShrink: 0 }}>
        <div className="lm-workbench-list-header">
          <h2>草稿审核</h2>
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => void loadDrafts()}>
            刷新
          </button>
        </div>
        <p className="lm-meta lm-review-workbench-intro">
          落盘草稿在此<strong>由律师把关</strong>：通过 / 需修改 / 驳回；并满足验收门禁后，再用「渲染交付物」生成 Word 等。<strong>未经本页通过，不宜视为可对外交付。</strong>不在这里改聊天。
        </p>
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
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
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
                <span className={`lm-badge lm-draft-status-${d.reviewStatus ?? "pending"}`}>
                  {reviewStatusDisplayLabel(d.reviewStatus)}
                </span>
                {d.matterId && <span className="lm-matter-badge">{d.matterId}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="lm-split-handle lm-split-handle-vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整草稿列表宽度"
        title="拖动调整列表宽度"
        onPointerDown={onReviewListResize}
      />

      <div className="lm-workbench-main lm-review-detail-main">
        {!selectedTaskId && (
          <div className="lm-meta lm-workbench-placeholder">选择左侧草稿进行审阅与签批</div>
        )}
        {selectedTaskId && detailLoading && <div className="lm-meta">加载草稿…</div>}
        {selectedTaskId && !detailLoading && detail && (
          <>
            <LawmindReviewSelfCheckSummary
              acceptance={acceptance}
              citation={citationIntegrity}
              deliverableType={detail.deliverableType}
            />
            <div id="lm-review-citation-banner">
              <LawmindCitationBanner view={citationIntegrity} apiBase={apiBase} taskId={selectedTaskId ?? undefined} />
            </div>
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
            <LawmindAcceptanceGate report={acceptance} />
            <div className="lm-workbench-toolbar">
              <div>
                <h2>{detail.title}</h2>
                <p className="lm-meta">
                  任务 {detail.taskId} · 输出 {detail.output} · 模板 {detail.templateId}
                  {detail.matterId ? ` · 案件 ${detail.matterId}` : ""} · 签批{" "}
                  {reviewStatusDisplayLabel(detail.reviewStatus)}
                </p>
                {(detail.reviewStatus ?? "pending") !== "pending" ? (
                  <p className="lm-meta lm-review-signoff-locked">
                    本草稿已签批为「{reviewStatusDisplayLabel(detail.reviewStatus)}」：上方三个签批已锁定；「渲染交付物」仅在被标为「通过」后可用。若已按意见改好正文、或需重新签批，请点「恢复待审核」。
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
              <div className="lm-review-actions">
                {(detail.reviewStatus ?? "pending") !== "pending" ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    disabled={actionBusy}
                    onClick={() => void submitReopenReview()}
                  >
                    恢复待审核
                  </button>
                ) : null}
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                  onClick={() => void submitReview("rejected")}
                >
                  驳回
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary"
                  disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                  onClick={() => void submitReview("modified")}
                >
                  需修改
                </button>
                <button
                  type="button"
                  className="lm-btn"
                  disabled={actionBusy || (detail.reviewStatus ?? "pending") !== "pending"}
                  onClick={() => void submitReview("approved")}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="lm-btn lm-btn-accent"
                  disabled={
                    actionBusy ||
                    (detail.reviewStatus ?? "pending") !== "approved" ||
                    (acceptance != null && acceptance.deliverableType != null && !acceptance.ready)
                  }
                  title={
                    acceptance && acceptance.deliverableType && !acceptance.ready
                      ? "草稿未通过验收门禁，请先补齐缺失项"
                      : (detail.reviewStatus ?? "pending") !== "approved"
                        ? `需先将签批标为「通过」后才能渲染（当前：${reviewStatusDisplayLabel(detail.reviewStatus)}）`
                        : undefined
                  }
                  onClick={() => void submitRender()}
                >
                  渲染交付物
                </button>
                {edition.features.acceptancePackExport && (
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary"
                    disabled={
                      packBusy ||
                      (detail.reviewStatus ?? "pending") !== "approved" ||
                      (acceptance != null && acceptance.deliverableType != null && !acceptance.ready)
                    }
                    title={
                      acceptance && acceptance.deliverableType && !acceptance.ready
                        ? "草稿未通过验收门禁，请先补齐缺失项"
                        : (detail.reviewStatus ?? "pending") !== "approved"
                          ? `需先「通过」后再下载（当前：${reviewStatusDisplayLabel(detail.reviewStatus)}）`
                          : `下载验收交付包（${edition.label}）`
                    }
                    onClick={() => void downloadAcceptancePack()}
                  >
                    {packBusy ? "生成中…" : "下载验收交付包"}
                  </button>
                )}
              </div>
            </div>

            {actionMsg ? (
              <div className="lm-meta lm-review-msg" role="status" aria-live="polite">
                {actionMsg}
              </div>
            ) : null}

            <label className="lm-review-note">
              <span className="lm-review-note-title">审核备注（可选）</span>
              <p className="lm-review-note-hint">点「通过 / 需修改 / 驳回」时会一并提交；可在此写理由。</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例如：须补充××条款依据、与当事人核实××事实后再定稿…"
                rows={4}
              />
            </label>

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

            <div className="lm-draft-preview">{renderInlineSections(detail, apiBase)}</div>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
