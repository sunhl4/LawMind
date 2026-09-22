/**
 * 法律推理 Markdown 折叠区 — 与记忆面板视觉一致。
 */

import { useId, useState } from "react";

type Props = {
  markdown: string;
  variant?: "chat" | "workbench";
  defaultOpen?: boolean;
  title?: string;
};

export function LawmindReasoningCollapsible(props: Props) {
  const {
    markdown,
    variant = "workbench",
    defaultOpen,
    title = "法律推理摘要",
  } = props;
  const panelId = useId();
  const [open, setOpen] = useState(
    defaultOpen !== undefined ? defaultOpen : variant === "workbench",
  );

  if (!markdown.trim()) {
    return null;
  }

  const lines = markdown.split("\n").length;
  return (
    <section
      className={`lm-context-panel lm-context-panel--reasoning lm-context-panel--${variant}`}
      aria-label={title}
    >
      <button
        type="button"
        className="lm-context-panel-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        id={`${panelId}-trigger`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lm-context-panel-title">{title}</span>
        <span className="lm-context-panel-badges" aria-hidden>
          <span className="lm-badge-soft">LegalReasoningGraph</span>
          <span className="lm-badge-soft">约 {lines} 行</span>
        </span>
        <span className={`lm-context-panel-chevron ${open ? "lm-context-panel-chevron--open" : ""}`} aria-hidden>
          ›
        </span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="lm-context-panel-body"
        role="region"
        aria-labelledby={`${panelId}-trigger`}
      >
        <pre className="lm-reasoning-pre">{markdown}</pre>
      </div>
    </section>
  );
}
