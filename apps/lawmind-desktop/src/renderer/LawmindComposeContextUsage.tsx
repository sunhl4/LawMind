/**
 * 对话变长时，在输入栏给律师一个安静的入口。
 *
 * 用量桶、模型窗口和额度数字留在引擎里（见 `context-budget.ts`），不进律师面。
 * 对话还短、也没整理过时，这个控件不出现：助手会在回合里自己整理并继续办。
 * 变长或已经整理过，才让律师选择「整理这场对话」或「另开一段」。
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
  /** 建议另起新对话的压缩次数门槛（服务端从 `context.carryover.suggestMinCompacts` 下发）。 */
  suggestMinCompacts?: number;
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
  /**
   * 回复还在输出。入口可打开；整理和带上文另起要等停稳，
   * 避免改写或读到半轮历史。
   */
  historyLocked?: boolean;
};

/** 短对话不打扰。变长，或已经整理过，律师才需要这个入口。 */
export function shouldShowConversationLengthControl(
  budget: ComposeContextBudget | null | undefined,
): boolean {
  if (!budget || budget.effectiveLimit <= 0) {
    return false;
  }
  if (budget.level === "warn" || budget.level === "compact") {
    return true;
  }
  if ((budget.compactCount ?? 0) > 0) {
    return true;
  }
  return Boolean(budget.lastCompact);
}

function lengthTone(level: string): "ok" | "warn" | "danger" {
  if (level === "compact") {
    return "danger";
  }
  if (level === "warn") {
    return "warn";
  }
  return "ok";
}

function lengthLabel(level: string, compactCount: number): string {
  if (level === "compact") {
    return "对话已很长";
  }
  if (level === "warn") {
    return "对话较长";
  }
  if (compactCount > 0) {
    return "已整理过";
  }
  return "这场对话";
}

function statusCopy(level: string): string {
  if (level === "compact") {
    return "这场对话已经很长。助手会自己整理并继续办，不用你计算用量。";
  }
  if (level === "warn") {
    return "这场对话开始变长。需要整理时，助手会自己收一收并继续办。";
  }
  return "助手已经整理过这场对话。稿子和案件材料都还在。";
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
    historyLocked = false,
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

  if (!budget || !shouldShowConversationLengthControl(budget)) {
    return null;
  }

  const tone = lengthTone(budget.level);
  const lastCompactAt = formatCompactAt(budget.lastCompact?.at);
  const compactCount = budget.compactCount ?? 0;
  const triggerLabel = lengthLabel(budget.level, compactCount);

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

  const confirmCopy = (() => {
    if (!confirm) {
      return "";
    }
    const preview = confirm.preview;
    if (preview?.compacted) {
      const count =
        preview.droppedMessageCount > 0
          ? `较早的约 ${preview.droppedMessageCount} 条来回`
          : "较早的来回";
      return `会把${count}收成要点。当前稿子不动。`;
    }
    if (confirm.kind === "distill") {
      return "这场对话还不需要整理。仍可以把已经说清的习惯交给你确认。";
    }
    return "这场对话还不需要整理。";
  })();

  return (
    <div className="lm-compose-ctx-usage" ref={rootRef} data-testid="lm-compose-ctx-usage">
      <button
        type="button"
        className={`lm-compose-ctx-usage-trigger lm-compose-ctx-usage-trigger--${tone}`}
        aria-label={`${triggerLabel}，打开整理或另开一段`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          historyLocked
            ? "可打开。整理或另起要等这一轮停稳，避免碰到半轮历史"
            : "整理这场对话，或另开一段"
        }
        disabled={disabled}
        data-testid="lm-compose-token-bar"
        onClick={() => {
          setOpen((v) => !v);
          setConfirm(null);
        }}
      >
        <span className="lm-compose-ctx-usage-frac">{triggerLabel}</span>
      </button>

      {open ? (
        <div
          className="lm-compose-ctx-usage-panel"
          role="dialog"
          aria-labelledby={titleId}
          data-testid="lm-compose-ctx-usage-panel"
        >
          <header className="lm-compose-ctx-usage-head">
            <h3 id={titleId}>这场对话</h3>
            <p className="lm-meta">{statusCopy(budget.level)}</p>
            {compactHint ? (
              <p className="lm-meta lm-compose-ctx-usage-hint" role="status">
                {compactHint}
              </p>
            ) : null}
          </header>

          {lastCompactAt || compactCount > 0 ? (
            <p className="lm-meta lm-compose-ctx-usage-lastcompact" data-testid="lm-compose-ctx-last-compact">
              {compactCount > 0 ? `已经整理过 ${compactCount} 次` : "已经整理过"}
              {lastCompactAt ? `，最近 ${lastCompactAt}` : ""}
              {budget.lastCompact?.midTurn ? "，当时没有打断你" : ""}
            </p>
          ) : null}

          {compactCount > 0 ? (
            <p className="lm-meta lm-compose-ctx-usage-honesty">
              若后面发现引用或细节开始漏，可以另开一段，把已经理清的内容带过去。
            </p>
          ) : null}

          {confirm ? (
            <div className="lm-compose-ctx-usage-confirm" data-testid="lm-compose-compact-confirm">
              <p className="lm-meta">{confirmCopy}</p>
              <div className="lm-compose-ctx-usage-confirm-actions">
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-compact-confirm-ok"
                  disabled={compactBusy || disabled || historyLocked}
                  title={historyLocked ? "这一轮还在输出，先停稳再整理" : undefined}
                  onClick={confirmAction}
                >
                  <span className="lm-compose-ctx-usage-action-title">
                    {confirm.kind === "distill" ? "确认记住" : "确认整理"}
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
                  disabled={compactBusy || previewBusy || disabled || historyLocked}
                  title={historyLocked ? "这一轮还在输出，先停稳再整理" : undefined}
                  onClick={() => void beginAction("compact")}
                >
                  <span className="lm-compose-ctx-usage-action-title">
                    {compactBusy || previewBusy ? "整理中…" : "整理这场对话"}
                  </span>
                  <span className="lm-meta">把较早的来回收成要点，当前稿子不动</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="lm-compose-ctx-usage-action"
                  data-testid="lm-compose-distill"
                  disabled={compactBusy || previewBusy || disabled || historyLocked}
                  title={historyLocked ? "这一轮还在输出，先停稳再整理" : undefined}
                  onClick={() => void beginAction("distill")}
                >
                  <span className="lm-compose-ctx-usage-action-title">整理并记住要点</span>
                  <span className="lm-meta">可复用的习惯要你确认才会记住</span>
                </button>
              </li>
              {onForkWithCarryover ? (
                <li>
                  <button
                    type="button"
                    className="lm-compose-ctx-usage-action"
                    data-testid="lm-compose-fork-carryover"
                    disabled={forkBusy || disabled || historyLocked}
                    title={
                      historyLocked ? "这一轮还在输出，先停稳再另起，避免读到半轮历史" : undefined
                    }
                    onClick={() => {
                      setOpen(false);
                      void onForkWithCarryover();
                    }}
                  >
                    <span className="lm-compose-ctx-usage-action-title">
                      {forkBusy ? "正在带过去…" : "另起新对话（带上文）"}
                    </span>
                    <span className="lm-meta">已理清的内容带过去；稿子和案件材料留在本案</span>
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
                    <span className="lm-meta">打开记忆，由你决定记什么</span>
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
