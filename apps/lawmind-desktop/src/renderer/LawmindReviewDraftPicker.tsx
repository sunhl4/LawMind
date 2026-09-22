import type { ArtifactDraft } from "../../../../src/lawmind/types.ts";
import { reviewStatusDisplayLabel } from "./lawmind-review-display";

type FilterMode = "pending" | "all";

type Props = {
  drafts: ArtifactDraft[];
  filtered: ArtifactDraft[];
  selectedTaskId: string | null;
  onSelectTaskId: (taskId: string | null) => void;
  filter: FilterMode;
  onFilterChange: (filter: FilterMode) => void;
  statusFilter: ArtifactDraft["reviewStatus"] | "all";
  onStatusFilterChange: (status: ArtifactDraft["reviewStatus"] | "all") => void;
  matterFilter: string;
  onMatterFilterChange: (matterId: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

function draftOptionLabel(draft: ArtifactDraft): string {
  const status = reviewStatusDisplayLabel(draft.reviewStatus);
  const matter = draft.matterId?.trim() ? ` · ${draft.matterId.trim()}` : "";
  return `${draft.title} — ${status}${matter}`;
}

export function LawmindReviewDraftPicker(props: Props) {
  const {
    drafts,
    filtered,
    selectedTaskId,
    onSelectTaskId,
    filter,
    onFilterChange,
    statusFilter,
    onStatusFilterChange,
    matterFilter,
    onMatterFilterChange,
    loading,
    error,
    onRefresh,
  } = props;

  const scopeActive = matterFilter.trim() !== "" || statusFilter !== "all";
  const selectedInList = filtered.some((d) => d.taskId === selectedTaskId);

  return (
    <div className="lm-review-draft-toolbar" role="region" aria-label="草稿选择与筛选">
      <div className="lm-review-draft-toolbar-row">
        <div className="lm-review-segmented" role="tablist" aria-label="列表范围">
          <button
            type="button"
            role="tab"
            id="lm-review-draft-tab-pending"
            aria-selected={filter === "pending"}
            aria-controls="lm-review-draft-panel"
            tabIndex={filter === "pending" ? 0 : -1}
            className={`lm-review-segment ${filter === "pending" ? "lm-review-segment-active" : ""}`}
            onClick={() => onFilterChange("pending")}
          >
            待审核
          </button>
          <button
            type="button"
            role="tab"
            id="lm-review-draft-tab-all"
            aria-selected={filter === "all"}
            aria-controls="lm-review-draft-panel"
            tabIndex={filter === "all" ? 0 : -1}
            className={`lm-review-segment ${filter === "all" ? "lm-review-segment-active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            全部
          </button>
        </div>

        <div
          role="tabpanel"
          id="lm-review-draft-panel"
          aria-labelledby={filter === "pending" ? "lm-review-draft-tab-pending" : "lm-review-draft-tab-all"}
          tabIndex={0}
        >
        <label className="lm-review-draft-select-field">
          <span className="lm-sr-only">选择草稿</span>
          <select
            className="lm-review-draft-select"
            aria-label="选择草稿"
            value={selectedInList ? (selectedTaskId ?? "") : ""}
            disabled={loading || filtered.length === 0}
            onChange={(e) => {
              const id = e.target.value.trim();
              onSelectTaskId(id || null);
            }}
          >
            <option value="" disabled>
              {loading
                ? "加载中…"
                : filtered.length === 0
                  ? scopeActive
                    ? "无匹配草稿"
                    : filter === "pending"
                      ? "暂无待审核"
                      : "暂无草稿"
                  : "选择草稿…"}
            </option>
            {filtered.map((d) => (
              <option key={d.taskId} value={d.taskId}>
                {draftOptionLabel(d)}
              </option>
            ))}
          </select>
        </label>

        <label className="lm-review-toolbar-field">
          <span className="lm-sr-only">签批状态</span>
          <select
            className="lm-review-toolbar-input"
            value={statusFilter}
            aria-label="签批状态"
            onChange={(e) => onStatusFilterChange(e.target.value as ArtifactDraft["reviewStatus"] | "all")}
          >
            <option value="all">状态</option>
            <option value="pending">待审核</option>
            <option value="modified">需修改</option>
            <option value="approved">已通过</option>
            <option value="rejected">已驳回</option>
          </select>
        </label>

        <label className="lm-review-toolbar-field lm-review-toolbar-field-matter">
          <span className="lm-sr-only">案件范围</span>
          <input
            type="search"
            className="lm-review-toolbar-input"
            value={matterFilter}
            aria-label="案件编号"
            onChange={(e) => onMatterFilterChange(e.target.value)}
            placeholder="案件"
          />
        </label>

        {scopeActive ? (
          <button
            type="button"
            className="lm-review-toolbar-ghost"
            title="清除筛选"
            onClick={() => {
              onMatterFilterChange("");
              onStatusFilterChange("all");
            }}
          >
            清除
          </button>
        ) : null}

        <span className="lm-review-draft-toolbar-count" aria-live="polite">
          {loading ? "…" : `${filtered.length}/${drafts.length}`}
        </span>

        <button
          type="button"
          className="lm-review-toolbar-icon-btn"
          title="刷新草稿列表"
          aria-label="刷新草稿列表"
          disabled={loading}
          onClick={() => onRefresh()}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 3.5V8H9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        </div>
      </div>

      {error ? (
        <div className="lm-callout lm-callout-danger lm-review-draft-toolbar-error" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
