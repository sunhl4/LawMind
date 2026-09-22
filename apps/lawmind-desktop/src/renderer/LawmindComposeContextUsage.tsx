/**
 * Cursor-style context usage ring on the compose model row.
 * Click → token detail + 整理上下文 / 沉淀知识库 / 记忆检查.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ComposeContextBudget = {
  used: number;
  effectiveLimit: number;
  level: string;
};

export type CompactPreview = {
  compacted: boolean;
  droppedMessageCount: number;
  estimatedDroppedTokens: number;
  useLlmDigestAvailable: boolean;
  useLlmDigest: boolean;
};

export type LawmindComposeContextUsageProps = {
  budget: ComposeContextBudget | null;
  compactBusy?: boolean;
  compactHint?: string | null;
  onCompact: () => void | Promise<void>;
  onDistill: () => void | Promise<void>;
  /** Optional dry-run preview before compact (F4). */
  onPreviewCompact?: () => Promise<CompactPreview | null>;
  onOpenMemory?: () => void;
  disabled?: boolean;
};

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  if (n >= 10_000) {
    return `${Math.round(n / 1000)}k`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    const s = k.toFixed(1);
    return `${s.endsWith(".0") ? s.slice(0, -2) : s}k`;
  }
  return String(Math.round(n));
}

function ringTone(level: string): "ok" | "warn" | "danger" {
  if (level === "compact") {
    return "danger";
  }
  if (level === "warn") {
    return "warn";
  }
  return "ok";
}

export function LawmindComposeContextUsage(props: LawmindComposeContextUsageProps): ReactNode {
  const {
    budget,
    compactBusy = false,
    compactHint = null,
    onCompact,
    onDistill,
    onPreviewCompact,
    onOpenMemory,
    disabled = false,
  } = props;

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<{
    kind: "compact" | "distill";
    preview: CompactPreview | null;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (!t || rootRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
      setConfirm(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (confirm) {
          setConfirm(null);
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, confirm]);

  if (!budget || budget.effectiveLimit <= 0) {
    return null;
  }

  const pct = Math.min(100, Math.max(0, (budget.used / budget.effectiveLimit) * 100));
  const tone = ringTone(budget.level);
  const r = 7;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  const beginAction = async (kind: "compact" | "distill") => {
    if (!onPreviewCompact) {
      if (kind === "compact") {
        void onCompact();
      } else {
        void onDistill();
      }
      return;
    }
    setPreviewBusy(true);
    try {
      const preview = await onPreviewCompact();
      setConfirm({ kind, preview });
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmAction = () => {
    if (!confirm) {
      return;
    }
    const kind = confirm.kind;
    setConfirm(null);
    if (kind === "compact") {
      void onCompact();
    } else {
      void onDistill();
    }
  };

  return (
    <div className="lm-compose-ctx-usage" ref={rootRef} data-testid="lm-compose-ctx-usage">
      <button
        type="button"
        className={`lm-compose-ctx-usage-trigger lm-compose-ctx-usage-trigger--${tone}`}
        aria-label={`上下文约 ${budget.used} / ${budget.effectiveLimit} 额度，打开用量与整理`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="上下文用量 · 点击整理或沉淀"
        disabled={disabled}
        data-testid="lm-compose-token-bar"
        onClick={() => {
          setOpen((v) => !v);
          setConfirm(null);
        }}
      >
        <svg className="lm-compose-ctx-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle className="lm-compose-ctx-ring-track" cx="9" cy="9" r={r} fill="none" />
          <circle
            className="lm-compose-ctx-ring-fill"
            cx="9"
            cy="9"
            r={r}
            fill="none"
            strokeDasharray={`${dash} ${c}`}
            strokeDashoffset={c * 0.25}
            transform="rotate(-90 9 9)"
          />
        </svg>
        <span className="lm-compose-ctx-usage-frac">
          {formatTokenCount(budget.used)}/{formatTokenCount(budget.effectiveLimit)}
        </span>
      </button>

      {open ? (
        <div
          className="lm-compose-ctx-usage-panel"
          role="dialog"
          aria-labelledby={titleId}
          data-testid="lm-compose-ctx-usage-panel"
        >
          <header className="lm-compose-ctx-usage-head">
            <h3 id={titleId}>上下文用量</h3>
            <p className="lm-meta">
              约 {budget.used.toLocaleString("zh-CN")} / {budget.effectiveLimit.toLocaleString("zh-CN")}{" "}
              额度（{Math.round(pct)}%）
              {tone === "warn" ? " · 接近上限" : tone === "danger" ? " · 建议压缩" : ""}
            </p>
            {compactHint ? (
              <p className="lm-meta lm-compose-ctx-usage-hint" role="status">
                {compactHint}
              </p>
            ) : null}
          </header>

          <div className="lm-compose-ctx-usage-meter" aria-hidden>
            <div
              className={`lm-compose-ctx-usage-meter-fill lm-compose-ctx-usage-meter-fill--${tone}`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {confirm ? (
            <div className="lm-compose-ctx-usage-confirm" data-testid="lm-compose-compact-confirm">
              <p className="lm-meta">
                {confirm.preview?.compacted
                  ? `预计移除约 ${confirm.preview.droppedMessageCount} 条消息（约 ${confirm.preview.estimatedDroppedTokens.toLocaleString("zh-CN")} 额度）${
                      confirm.preview.useLlmDigestAvailable
                        ? "；将尝试智能连贯摘要（失败则回退要点提取）"
                        : "；使用要点提取"
                    }。`
                  : confirm.kind === "distill"
                    ? "当前无需压缩；仍可从现有对话沉淀偏好/案件要点到记忆检查。"
                    : "当前无需压缩。"}
              </p>
              <div className="lm-compose-ctx-usage-confirm-actions">
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-compact-confirm-ok"
                  disabled={compactBusy || disabled}
                  onClick={confirmAction}
                >
                  <span className="lm-compose-ctx-usage-action-title">
                    {confirm.kind === "distill" ? "确认沉淀" : "确认整理"}
                  </span>
                </button>
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-compact-confirm-cancel"
                  disabled={compactBusy || disabled}
                  onClick={() => setConfirm(null)}
                >
                  <span className="lm-compose-ctx-usage-action-title">取消</span>
                </button>
              </div>
            </div>
          ) : (
            <ul className="lm-compose-ctx-usage-actions">
              <li>
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-compact"
                  disabled={compactBusy || previewBusy || disabled}
                  onClick={() => void beginAction("compact")}
                >
                  <span className="lm-compose-ctx-usage-action-title">
                    {compactBusy || previewBusy ? "整理中…" : "整理上下文"}
                  </span>
                  <span className="lm-meta">压缩对话</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-distill"
                  disabled={compactBusy || previewBusy || disabled}
                  onClick={() => void beginAction("distill")}
                >
                  <span className="lm-compose-ctx-usage-action-title">整理并沉淀</span>
                  <span className="lm-meta">压缩并沉淀</span>
                </button>
              </li>
              {onOpenMemory ? (
                <li>
                  <button
                    type="button"
                    className="lm-compose-ctx-usage-action"
                    data-testid="lm-compose-open-memory"
                    disabled={disabled}
                    onClick={() => {
                      setOpen(false);
                      onOpenMemory();
                    }}
                  >
                    <span className="lm-compose-ctx-usage-action-title">让助手记住</span>
                    <span className="lm-meta">写入记忆</span>
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
