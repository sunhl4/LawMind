/**
 * Cursor-style context usage ring on the compose model row.
 * Click → token detail（原始窗口 / 可用 / 自动整理线 + 分层用量）+ 整理上下文 / 沉淀知识库 / 记忆检查.
 *
 * 与主流（Codex `/status`、Cursor context breakdown）对齐的三件事：
 * - 圆环**常驻**，不是只在告警时才出现；
 * - 面板给出「原始窗口 / 可用窗口 / 自动整理线」三元组，律师能把界面数字和模型对上；
 * - 分层用量（律师发言 / 工具回包 / 钉选材料 / 本轮清单 / 系统规则……），而不是一个笼统的「额度」。
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type ComposeContextBreakdownBucket = {
  id: string;
  tokens: number;
};

export type ComposeContextWindow = {
  contextTokens: number;
  maxOutputTokens?: number;
  summaryOutputTokenReserve?: number;
  autoCompactBufferTokens?: number;
  usableLimit: number;
  /** 回合开始时的自动整理线（= 可用窗口）。 */
  autoCompactLimit?: number;
  /** 回合内（工具轮边界）整理线；越线后运行时整理并继续本回合。 */
  midTurnCompactLimit?: number;
};

export type ComposeLastCompact = {
  at?: string;
  droppedMessageCount?: number;
  midTurn?: boolean;
};

export type ComposeContextBudget = {
  used: number;
  effectiveLimit: number;
  level: string;
  /** 实际参与估算的模型（compose 里选中的那个）。 */
  modelId?: string;
  breakdown?: ComposeContextBreakdownBucket[];
  window?: ComposeContextWindow;
  compactCount?: number;
  lastCompact?: ComposeLastCompact | null;
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
  /**
   * 另起新对话并带上文（续接种子）。按仓库口径，这是**律师主动**的入口；
   * 「上下文过多」的一次性建议卡另见 `LawmindContextForkSuggestion`。
   */
  onForkWithCarryover?: () => void | Promise<void>;
  forkBusy?: boolean;
  disabled?: boolean;
};

/** 分层用量标签。顺序与引擎 `TOKEN_BUDGET_BUCKET_ORDER` 一致（律师侧 → 系统侧）。 */
const BREAKDOWN_LABELS: Record<string, string> = {
  lawyer: "律师发言",
  assistant: "助手回复",
  toolResults: "工具回包",
  digest: "压缩摘要",
  turnContext: "本轮上下文",
  pins: "钉选材料",
  plan: "本轮清单",
  craft: "改稿手艺",
  workspace: "交付与案件设置",
  rules: "系统规则",
};

function breakdownLabel(id: string): string {
  return BREAKDOWN_LABELS[id] ?? id;
}

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

function levelSuffix(level: string): string {
  if (level === "compact") {
    return " · 已达自动整理线";
  }
  if (level === "warn") {
    return " · 接近自动整理线，可整理";
  }
  return "";
}

function formatCompactAt(iso: string | undefined): string | undefined {
  if (!iso) {
    return undefined;
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return undefined;
  }
}

function visibleBuckets(
  buckets: ComposeContextBreakdownBucket[] | undefined,
): ComposeContextBreakdownBucket[] {
  return (buckets ?? []).filter((b) => b.tokens > 0);
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
    onForkWithCarryover,
    forkBusy = false,
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
      return undefined;
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

  const buckets = visibleBuckets(budget.breakdown);
  const breakdownTotal = buckets.reduce((n, b) => n + b.tokens, 0);
  const win = budget.window;
  const midTurnLine = win?.midTurnCompactLimit;
  const rows = budget.breakdown ?? [];
  const lastCompactAt = formatCompactAt(budget.lastCompact?.at);
  const compactCount = budget.compactCount ?? 0;

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
              可用额度（{Math.round(pct)}%）
              {levelSuffix(budget.level)}
            </p>
            {win ? (
              <p className="lm-meta lm-compose-ctx-usage-window" data-testid="lm-compose-ctx-window">
                模型窗口 {formatTokenCount(win.contextTokens)} · 可用{" "}
                {formatTokenCount(win.usableLimit)}
                {typeof midTurnLine === "number"
                  ? ` · 自动整理线 ${formatTokenCount(midTurnLine)}`
                  : ""}
                {budget.modelId ? ` · ${budget.modelId}` : ""}
              </p>
            ) : null}
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

          {buckets.length > 0 ? (
            <div className="lm-compose-ctx-usage-breakdown" data-testid="lm-compose-ctx-breakdown">
              <div className="lm-compose-ctx-usage-breakdown-bar" aria-hidden>
                {buckets.map((b) => (
                  <span
                    key={b.id}
                    className={`lm-compose-ctx-usage-seg lm-compose-ctx-usage-seg--${b.id}`}
                    style={{ width: `${breakdownTotal > 0 ? (b.tokens / breakdownTotal) * 100 : 0}%` }}
                  />
                ))}
              </div>
              <ul className="lm-compose-ctx-usage-breakdown-list">
                {rows
                  .filter((b) => b.tokens > 0)
                  .map((b) => (
                    <li key={b.id} className="lm-compose-ctx-usage-breakdown-row">
                      <span
                        className={`lm-compose-ctx-usage-dot lm-compose-ctx-usage-dot--${b.id}`}
                        aria-hidden
                      />
                      <span className="lm-compose-ctx-usage-breakdown-label">
                        {breakdownLabel(b.id)}
                      </span>
                      <span className="lm-compose-ctx-usage-breakdown-tokens">
                        {formatTokenCount(b.tokens)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          {lastCompactAt || compactCount > 0 ? (
            <p className="lm-meta lm-compose-ctx-usage-lastcompact" data-testid="lm-compose-ctx-last-compact">
              {compactCount > 0 ? `本对话已整理 ${compactCount} 次` : "本对话已整理过"}
              {lastCompactAt ? `，最近 ${lastCompactAt}` : ""}
              {budget.lastCompact?.midTurn ? "（回合内自动整理，未中断）" : ""}
            </p>
          ) : null}

          {compactCount > 0 ? (
            <p className="lm-meta lm-compose-ctx-usage-honesty">
              同一对话反复整理会让引用与细节更容易漏检；长任务更适合另起新对话并把整理稿带过去。
            </p>
          ) : null}

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
              {onForkWithCarryover ? (
                <li>
                  <button
                    type="button"
                    className="lm-compose-ctx-usage-action"
                    data-testid="lm-compose-fork-carryover"
                    disabled={forkBusy || disabled}
                    onClick={() => {
                      setOpen(false);
                      void onForkWithCarryover();
                    }}
                  >
                    <span className="lm-compose-ctx-usage-action-title">
                      {forkBusy ? "正在带过去…" : "另起新对话（带上文）"}
                    </span>
                    <span className="lm-meta">整理稿带进新对话；草稿与案件档案留在原处</span>
                  </button>
                </li>
              ) : null}
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
