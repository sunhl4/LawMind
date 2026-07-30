import type { RefObject, ReactNode } from "react";
import {
  buildCaseFocusDraft,
  type CaseDraftVariant,
  type CaseFocusContext,
} from "./matter-case-focus";
import type { MatterSearchHit } from "./matter-interaction";

type Props = {
  caseFocusContext: CaseFocusContext | null;
  caseDraftVariant: CaseDraftVariant;
  caseDraftNote: string;
  caseActionBusy: boolean;
  caseActionMsg: string | null;
  searchQ: string;
  searchBusy: boolean;
  searchHits: MatterSearchHit[];
  searchIndexMissing?: boolean;
  coreIssues: string[];
  riskNotes: string[];
  artifacts: string[];
  caseMemory: string;
  caseTruncated: boolean;
  coreIssuesRef: RefObject<HTMLHeadingElement | null>;
  riskNotesRef: RefObject<HTMLHeadingElement | null>;
  artifactsRef: RefObject<HTMLHeadingElement | null>;
  caseMdRef: RefObject<HTMLHeadingElement | null>;
  onClearCaseFocus: () => void;
  onCaseDraftVariantChange: (variant: CaseDraftVariant) => void;
  onCaseDraftNoteChange: (note: string) => void;
  onSearchQueryChange: (query: string) => void;
  onRunSearch: () => void;
  onWriteCaseFocusNote: () => void;
};

export function MatterCasePanel(props: Props): ReactNode {
  const {
    caseFocusContext,
    caseDraftVariant,
    caseDraftNote,
    caseActionBusy,
    caseActionMsg,
    searchQ,
    searchBusy,
    searchHits,
    searchIndexMissing = false,
    coreIssues,
    riskNotes,
    artifacts,
    caseMemory,
    caseTruncated,
    coreIssuesRef,
    riskNotesRef,
    artifactsRef,
    caseMdRef,
    onClearCaseFocus,
    onCaseDraftVariantChange,
    onCaseDraftNoteChange,
    onSearchQueryChange,
    onRunSearch,
    onWriteCaseFocusNote,
  } = props;

  return (
    <div className="lm-workbench-panel">
      {caseFocusContext ? (
        <div className="lm-case-focus-banner-wrap">
          <div className="lm-case-focus-banner">
            <div>
              <strong>{caseFocusContext.title}</strong>
            </div>
            <div className="lm-matter-ops-actions">
              {caseFocusContext.query ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-small"
                  disabled={searchBusy}
                  onClick={() => onRunSearch()}
                >
                  定位相关内容
                </button>
              ) : null}
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                disabled={caseActionBusy}
                onClick={() => onWriteCaseFocusNote()}
              >
                写入案件档案
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-small"
                onClick={onClearCaseFocus}
              >
                清除提示
              </button>
            </div>
          </div>
          <div className="lm-case-draft-variants">
            {(
              [
                ["conservative", "保守版"],
                ["standard", "标准版"],
                ["assertive", "强化版"],
              ] as const
            ).map(([variant, label]) => (
              <button
                key={variant}
                type="button"
                className={`lm-tab ${caseDraftVariant === variant ? "active" : ""}`}
                onClick={() => {
                  onCaseDraftVariantChange(variant);
                  onCaseDraftNoteChange(buildCaseFocusDraft(caseFocusContext, variant));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="lm-field lm-case-focus-draft">
            <span>建议草稿</span>
            <textarea
              value={caseDraftNote}
              onChange={(e) => onCaseDraftNoteChange(e.target.value)}
              rows={4}
              placeholder=""
            />
          </label>
          {caseActionMsg ? <div className="lm-meta lm-matter-action-msg">{caseActionMsg}</div> : null}
        </div>
      ) : null}
      <div className="lm-case-search">
        <input
          type="search"
          placeholder="搜索"
          value={searchQ}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onRunSearch();
            }
          }}
        />
        <button
          type="button"
          className="lm-btn lm-btn-secondary"
          disabled={searchBusy}
          onClick={() => onRunSearch()}
        >
          {searchBusy ? "…" : "搜索"}
        </button>
      </div>
      {searchIndexMissing ? (
        <p className="lm-meta lm-callout-muted">
          审计/会话全文索引尚未建立。请打开 <strong>设置 → 系统体检</strong>，在「本地搜索索引」中重建。
        </p>
      ) : null}
      {searchHits.length > 0 ? (
        <ul className="lm-search-hits">
          {searchHits.map((h, i) => (
            <li key={i}>
              <span className="lm-search-hit-section">
                {h.section}
                {h.source && h.source !== "matter" ? ` · ${h.source}` : ""}
              </span>
              <div>{h.text}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <h3 ref={coreIssuesRef}>核心争点</h3>
      <ul className="lm-bullet-list">
        {coreIssues.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <h3 ref={riskNotesRef}>风险与待确认</h3>
      <ul className="lm-bullet-list">
        {riskNotes.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <h3 ref={artifactsRef}>生成产物</h3>
      <ul className="lm-bullet-list">
        {artifacts.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
      <h3 ref={caseMdRef}>案件档案（CASE.md）{caseTruncated ? "（已截断显示）" : ""}</h3>
      <pre className="lm-case-md">{caseMemory}</pre>
    </div>
  );
}
