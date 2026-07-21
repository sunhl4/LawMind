/**
 * Compose chrome above the resizable input (errors, model warn, queue, token, attachments).
 * Extracted from lawmind-chat-shell for maintainability (R-P1-2).
 */

import { useMemo, type ReactNode } from "react";
import { LawmindComposeAttachments } from "./LawmindComposeAttachments";
import { composeModelHintCalloutClass } from "./lawmind-compose-model-hint";
import { isPrivilegeTipUiEnabled, scanPrivilegeTip } from "./lawmind-privilege-tip";
import type { LawmindComposeExtras } from "./useLawmindComposeExtras";

export type LawmindChatComposeChromeProps = {
  error: string | null;
  apiBase?: string;
  composeModelConfigured?: boolean;
  onOpenApiWizard?: () => void;
  onOpenComposeSettings?: () => void;
  composeModelHint?: string | null;
  composeModelQuickTestBusy?: boolean;
  /** Draft text for privilege preflight tip (E10). */
  composeInput?: string;
  queuedMessages: string[];
  cancelQueuedMessage?: (index: number) => void;
  composeExtras: LawmindComposeExtras;
  fileChatPills: Array<{ id: string; shortLabel: string; title: string; relPath?: string }>;
  contextMatterId: string | null;
  contextTaskId: string | null;
  matterTitle: string | null;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  onClearMatter?: () => void;
  onClearTask?: () => void;
};

export function LawmindChatComposeChrome(props: LawmindChatComposeChromeProps): ReactNode {
  const {
    error,
    apiBase,
    composeModelConfigured,
    onOpenApiWizard,
    onOpenComposeSettings,
    composeModelHint,
    composeModelQuickTestBusy,
    composeInput,
    queuedMessages,
    cancelQueuedMessage,
    composeExtras: extras,
    fileChatPills,
    contextMatterId,
    contextTaskId,
    matterTitle,
    onRemoveFileChatPill,
    onClearFileChatPills,
    onClearMatter,
    onClearTask,
  } = props;

  const privilegeTip = useMemo(() => {
    if (!isPrivilegeTipUiEnabled()) {
      return null;
    }
    return scanPrivilegeTip(composeInput ?? "");
  }, [composeInput]);

  return (
    <div className="lm-compose-chrome">
      {privilegeTip ? (
        <div
          className={
            privilegeTip.level === "warn"
              ? "lm-callout lm-callout-warn"
              : "lm-callout lm-callout-info"
          }
          role="status"
          data-testid="lm-privilege-tip"
        >
          <p className="lm-callout-body">{privilegeTip.message}</p>
        </div>
      ) : null}
      {error && !error.includes("Preload bridge") ? (
        <div className="lm-callout lm-callout-danger" role="alert">
          <p className="lm-callout-body">{error}</p>
        </div>
      ) : null}
      {composeModelConfigured === false && apiBase && (onOpenApiWizard || onOpenComposeSettings) ? (
        <div className="lm-callout lm-callout-warn lm-compose-model-warn" role="status">
          <p className="lm-callout-body lm-compose-model-warn-text">
            尚未配置可用的主模型 API，对话暂时无法发送。请先完成向导或添加自定义模型。
          </p>
          <div className="lm-compose-model-warn-actions">
            {onOpenApiWizard ? (
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onOpenApiWizard()}>
                API 配置向导…
              </button>
            ) : null}
            {onOpenComposeSettings ? (
              <button type="button" className="lm-btn lm-btn-small" onClick={() => onOpenComposeSettings()}>
                模型设置…
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {(composeModelHint?.trim() || composeModelQuickTestBusy) ? (
        <div
          className={composeModelHintCalloutClass(
            composeModelHint,
            composeModelQuickTestBusy ?? false,
          )}
          role="status"
        >
          {composeModelQuickTestBusy && !(composeModelHint ?? "").trim()
            ? "正在测试模型连接…"
            : (composeModelHint ?? "").trim()}
        </div>
      ) : null}
      {queuedMessages.length > 0 ? (
        <div className="lm-compose-queue" role="status">
          <span className="lm-meta">排队中 {queuedMessages.length} 条</span>
          <ul>
            {queuedMessages.map((q, i) => (
              <li key={`q-${i}`}>
                <span>{q.slice(0, 80)}</span>
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-small"
                  onClick={() => cancelQueuedMessage?.(i)}
                >
                  取消
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {extras.contextBudget &&
      (extras.contextBudget.level === "warn" || extras.contextBudget.level === "compact") ? (
        <div
          className={`lm-compose-token-bar lm-compose-token-bar--${extras.contextBudget.level === "compact" ? "danger" : "warn"}`}
          role="status"
        >
          上下文约 {extras.contextBudget.used} / {extras.contextBudget.effectiveLimit} tokens
          {extras.contextBudget.level === "warn" ? " · 接近上限" : " · 建议压缩"}
        </div>
      ) : null}
      <LawmindComposeAttachments
        filePills={fileChatPills}
        contextMatterId={contextMatterId}
        contextTaskId={contextTaskId}
        matterTitle={matterTitle}
        onRemoveFilePill={onRemoveFileChatPill}
        onClearFilePills={onClearFileChatPills}
        onClearMatter={onClearMatter}
        onClearTask={onClearTask}
      />
    </div>
  );
}
