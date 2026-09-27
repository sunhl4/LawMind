import { useState, type ReactNode } from "react";
import { LawmindContractReviewLearningPanel } from "./LawmindContractReviewLearningPanel.js";
import { LawmindMemoryLibrary, type MemoryLibraryView } from "./LawmindMemoryLibrary.js";
import { LawmindMemoryTruthSources } from "./LawmindMemoryTruthSources.js";

type Props = {
  apiBase: string;
};

const VIEWS: Array<{ id: MemoryLibraryView; label: string }> = [
  { id: "habits", label: "我的习惯" },
  { id: "matter", label: "案件认知" },
  { id: "revoked", label: "已作废" },
];

/**
 * Settings → 记忆库。待确认写在「我的习惯」里，不单独占一页。
 */
export function LawmindSettingsMemory({ apiBase }: Props): ReactNode {
  const [view, setView] = useState<MemoryLibraryView>("habits");
  const [learningCount, setLearningCount] = useState(0);

  return (
    <div className="lm-settings-section lm-memory-settings" data-testid="lm-settings-memory">
      <div className="lm-memory-library-tabs" role="tablist" aria-label="记忆库">
        {VIEWS.map((row) => (
          <button
            key={row.id}
            type="button"
            role="tab"
            id={`lm-memory-tab-${row.id}`}
            aria-selected={view === row.id}
            aria-controls={`lm-memory-panel-${row.id}`}
            className={view === row.id ? "lm-btn lm-btn-sm lm-btn-accent" : "lm-btn lm-btn-ghost lm-btn-sm"}
            onClick={() => setView(row.id)}
          >
            {row.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`lm-memory-panel-${view}`} aria-labelledby={`lm-memory-tab-${view}`}>
        <LawmindMemoryLibrary apiBase={apiBase} view={view} />
      </div>

      <details className="lm-memory-fold lm-memory-fold--secondary">
        <summary>
          <span className="lm-memory-fold__label">已沉淀档案</span>
          <span className="lm-memory-fold__hint">只读</span>
        </summary>
        <div className="lm-memory-fold__body">
          <LawmindMemoryTruthSources apiBase={apiBase} embedInSettings />
        </div>
      </details>

      <details className="lm-memory-fold lm-memory-fold--secondary" open={learningCount > 0}>
        <summary>
          <span className="lm-memory-fold__label">合同改稿学习</span>
          {learningCount > 0 ? (
            <span className="lm-memory-fold__count">{learningCount}</span>
          ) : (
            <span className="lm-memory-fold__hint">签批后出现</span>
          )}
        </summary>
        <div className="lm-memory-fold__body">
          <LawmindContractReviewLearningPanel
            apiBase={apiBase}
            embedInSettings
            onDraftCountChange={setLearningCount}
          />
        </div>
      </details>
    </div>
  );
}
