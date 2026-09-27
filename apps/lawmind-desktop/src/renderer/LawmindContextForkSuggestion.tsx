import type { ReactNode } from "react";
import type { CarryoverOrigin } from "./LawmindMsgCarryoverNotice";

/**
 * 上下文过多 → 建议另起新对话（带上文）。
 *
 * 触发条件刻意不看「百分比」：「窗口快满」时运行时已经在工具轮边界自动整理过了，
 * 律师手上没有可操作的东西。真正的信号是 **这个会话已经被压过、而且还在长**——
 * Codex 自己也承认「长会话与多次压缩会让模型准确率下降」。所以：
 *   `lastCompact.midTurn === true || compactCount >= 2` 才建议。
 *
 * 按仓库口径（对话线程不堆过程芯片 / 拍板卡），**同一会话只出一次**，可关闭。
 */

export const CONTEXT_FORK_SUGGEST_MIN_COMPACTS = 2;

export type ContextForkSignal = {
  compactCount?: number;
  lastCompact?: { midTurn?: boolean } | null;
  /** 服务端下发（policy `context.carryover.suggestMinCompacts`）；缺省用内置默认。 */
  suggestMinCompacts?: number;
};

/** 聊天面板的续接 UI 入参（一个对象穿过 props 链，避免每层散 5 个 prop）。 */
export type ChatContextForkProps = {
  /** 本对话续接自哪条对话；空则不显示「续接来源」卡。 */
  carriedOverFrom?: CarryoverOrigin | null;
  /** 上下文过多 → 显示一次性建议卡（父层负责判定 + 已关闭持久化）。 */
  showSuggestion?: boolean;
  busy?: boolean;
  onFork?: () => void | Promise<void>;
  onDismiss?: () => void;
};

/** 是否该建议另起新对话。 */
export function shouldSuggestContextFork(signal: ContextForkSignal | null | undefined): boolean {
  if (!signal) {
    return false;
  }
  if (signal.lastCompact?.midTurn === true) {
    return true;
  }
  const min =
    typeof signal.suggestMinCompacts === "number" && Number.isFinite(signal.suggestMinCompacts)
      ? Math.max(1, Math.trunc(signal.suggestMinCompacts))
      : CONTEXT_FORK_SUGGEST_MIN_COMPACTS;
  return (signal.compactCount ?? 0) >= min;
}

export function LawmindContextForkSuggestion({
  busy = false,
  onFork,
  onDismiss,
}: {
  busy?: boolean;
  onFork: () => void | Promise<void>;
  onDismiss: () => void;
}): ReactNode {
  return (
    <div className="lm-ctx-fork-suggest" role="status" data-testid="lm-ctx-fork-suggest">
      <div className="lm-ctx-fork-suggest-body">
        <p className="lm-ctx-fork-suggest-head">这场对话已经比较长</p>
        <p className="lm-msg-carryover-meta">
          继续往下加，引用和细节更容易漏。可以另开一段，把已经理清的内容带过去。稿子和案件材料都留在本案。
        </p>
      </div>
      <div className="lm-ctx-fork-suggest-actions">
        <button
          type="button"
          className="lm-btn lm-btn-small lm-ctx-fork-suggest-go"
          data-testid="lm-ctx-fork-suggest-go"
          disabled={busy}
          onClick={() => void onFork()}
        >
          {busy ? "正在带过去…" : "另起新对话（带上文）"}
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small"
          data-testid="lm-ctx-fork-suggest-dismiss"
          disabled={busy}
          onClick={onDismiss}
        >
          继续本对话
        </button>
      </div>
    </div>
  );
}
