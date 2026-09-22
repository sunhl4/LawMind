import { useState, type ReactNode } from "react";
import { LawmindContractReviewLearningPanel } from "./LawmindContractReviewLearningPanel.js";
import { LawmindMemoryTruthSources } from "./LawmindMemoryTruthSources.js";
import MemoryInspector from "./MemoryInspector.js";

type Props = {
  apiBase: string;
};

/**
 * Settings → 记忆库：首屏只处理「待确认」；档案与合同学习收进折叠。
 */
export function LawmindSettingsMemory({ apiBase }: Props): ReactNode {
  const [pendingCount, setPendingCount] = useState(0);
  const [learningCount, setLearningCount] = useState(0);

  return (
    <div className="lm-settings-section lm-memory-settings" data-testid="lm-settings-memory">
      <p className="lm-memory-lead">
        点「确认」才会写入习惯。日常只需处理下方列表。
      </p>

      <section
        className={`lm-memory-block${pendingCount > 0 ? " lm-memory-block--primary" : ""}`}
        aria-labelledby="lm-memory-pending-title"
      >
        <header className="lm-memory-block__head lm-memory-block__head--compact">
          <div className="lm-memory-block__titles">
            <h3 id="lm-memory-pending-title" className="lm-memory-block__title">
              待确认
            </h3>
            {pendingCount > 0 ? (
              <span className="lm-memory-block__badge" data-testid="lm-memory-pending-badge">
                {pendingCount}
              </span>
            ) : null}
          </div>
        </header>
        <MemoryInspector
          baseUrl={apiBase}
          showTruthSources={false}
          simpleMode
          onPendingCountChange={setPendingCount}
        />
      </section>

      <details className="lm-memory-fold lm-memory-fold--secondary">
        <summary>
          <span className="lm-memory-fold__label">已沉淀档案</span>
          <span className="lm-memory-fold__hint">只读</span>
        </summary>
        <div className="lm-memory-fold__body">
          <LawmindMemoryTruthSources apiBase={apiBase} embedInSettings />
        </div>
      </details>

      <details
        className="lm-memory-fold lm-memory-fold--secondary"
        open={learningCount > 0}
      >
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
