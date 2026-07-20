import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatActivityToolBlock } from "./lawmind-chat-activity.js";
import {
  formatThoughtDurationLabel,
  thoughtToolSubtitle,
} from "./lawmind-chat-thought-view.js";

type Props = {
  tools: ChatActivityToolBlock[];
  reasoningMarkdown: string;
  streaming?: boolean;
  renderMarkdown: (text: string) => ReactNode;
};

function toolStatusBadge(status: ChatActivityToolBlock["status"]): string | null {
  if (status === "running") {
    return "进行中";
  }
  if (status === "failed") {
    return "失败";
  }
  return null;
}

function summarizeToolChips(tools: ChatActivityToolBlock[]): string {
  const labels = tools.map((t) => t.label).filter(Boolean);
  if (labels.length === 0) {
    return "过程";
  }
  if (labels.length <= 2) {
    return labels.join(" · ");
  }
  return `${labels.slice(0, 2).join(" · ")} 等 ${labels.length} 步`;
}

function LawmindChatThoughtPanelInner(props: Props): ReactNode {
  const { tools, reasoningMarkdown, streaming = false, renderMarkdown } = props;
  const hasTools = tools.length > 0;
  const hasReasoning = Boolean(reasoningMarkdown.trim());
  const isActive = streaming;
  const canRest = !isActive && (hasTools || hasReasoning);

  const [briefOpen, setBriefOpen] = useState(isActive);
  const [detailOpen, setDetailOpen] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (isActive) {
      if (startedAtRef.current == null) {
        startedAtRef.current = Date.now();
      }
      setBriefOpen(true);
      setDetailOpen(false);
      const tick = window.setInterval(() => {
        if (startedAtRef.current != null) {
          setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
        }
      }, 400);
      return () => window.clearInterval(tick);
    }
    if (startedAtRef.current != null) {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000)));
      startedAtRef.current = null;
    }
    // Done: collapse to chips by default (Cursor-style).
    setBriefOpen(false);
    setDetailOpen(false);
    return undefined;
  }, [isActive]);

  const chipSummary = useMemo(() => summarizeToolChips(tools), [tools]);

  if (!hasTools && !hasReasoning) {
    return isActive ? (
      <div className="lm-chat-thought lm-chat-thought-active" aria-live="polite">
        <div className="lm-chat-thought-wait">正在思考…</div>
      </div>
    ) : null;
  }

  const detailTitle = hasReasoning ? formatThoughtDurationLabel(elapsedSec, isActive) : null;
  const toolsHeadLabel = isActive
    ? hasTools
      ? `进行中 · ${chipSummary}`
      : "过程"
    : hasTools
      ? `已完成 · ${chipSummary}`
      : "过程";

  return (
    <div
      className={`lm-chat-thought ${isActive ? "lm-chat-thought-active" : ""} ${canRest ? "lm-chat-thought-done" : ""}`}
      aria-live={isActive ? "polite" : "off"}
      data-testid="lm-chat-thought-panel"
    >
      {hasTools ? (
        <section className="lm-chat-thought-section">
          <button
            type="button"
            className="lm-chat-thought-head"
            aria-expanded={briefOpen}
            onClick={() => setBriefOpen((v) => !v)}
          >
            <span className={`lm-chat-thought-chevron ${briefOpen ? "is-open" : ""}`} aria-hidden>
              ›
            </span>
            <span className="lm-chat-thought-head-label">{toolsHeadLabel}</span>
          </button>
          {!briefOpen && !isActive ? (
            <div className="lm-chat-thought-chips" aria-hidden>
              {tools.map((tool) => (
                <span
                  key={tool.id}
                  className={`lm-chat-thought-chip lm-chat-thought-chip-${tool.status}`}
                >
                  {tool.label}
                </span>
              ))}
            </div>
          ) : null}
          {briefOpen ? (
            <ul className="lm-chat-thought-steps">
              {tools.map((tool) => {
                const subtitle = thoughtToolSubtitle(tool);
                const badge = toolStatusBadge(tool.status);
                return (
                  <li
                    key={tool.id}
                    className={`lm-chat-thought-step lm-chat-thought-step-${tool.status}`}
                  >
                    <span className="lm-chat-thought-step-dot" aria-hidden>
                      •
                    </span>
                    <div className="lm-chat-thought-step-body">
                      <div className="lm-chat-thought-step-title-row">
                        <span className="lm-chat-thought-step-title">{tool.label}</span>
                        {badge ? (
                          <span className="lm-chat-thought-step-badge">{badge}</span>
                        ) : null}
                      </div>
                      {subtitle ? (
                        <div className="lm-chat-thought-step-sub">{subtitle}</div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      {hasReasoning ? (
        <section className="lm-chat-thought-section lm-chat-thought-section-detail">
          <button
            type="button"
            className="lm-chat-thought-head"
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen((v) => !v)}
          >
            <span className={`lm-chat-thought-chevron ${detailOpen ? "is-open" : ""}`} aria-hidden>
              ›
            </span>
            <span className="lm-chat-thought-head-label">{detailTitle}</span>
          </button>
          {detailOpen ? (
            <div className="lm-chat-thought-detail-body">
              {renderMarkdown(reasoningMarkdown)}
              {isActive ? <span className="lm-chat-activity-cursor" aria-hidden /> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {isActive && hasTools && !hasReasoning ? (
        <div className="lm-chat-thought-wait">等待模型继续…</div>
      ) : null}
    </div>
  );
}

export const LawmindChatThoughtPanel = memo(LawmindChatThoughtPanelInner);
