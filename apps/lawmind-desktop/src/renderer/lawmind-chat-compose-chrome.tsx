/**
 * Compose chrome above the resizable input (errors, model warn, queue, attachments).
 * Context token ring lives on the model toolbar row (Cursor-style).
 */

import { useMemo, type ReactNode } from "react";
import { LawmindComposeAttachments } from "./LawmindComposeAttachments";
import { LawmindSpreadsheetHintBar } from "./LawmindSpreadsheetHintBar";
import { LawmindWordRevisionBar } from "./LawmindWordRevisionBar";
import { composeModelHintCalloutClass } from "./lawmind-compose-model-hint";
import { isPrivilegeTipUiEnabled, scanPrivilegeTip } from "./lawmind-privilege-tip";

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
  onComposeInputChange?: (text: string) => void;
  queuedMessages: string[];
  cancelQueuedMessage?: (index: number) => void;
  fileChatPills: Array<{ id: string; shortLabel: string; title: string; relPath?: string }>;
  truthPills?: Array<{ id: string; shortLabel: string; title: string }>;
  contextMatterId: string | null;
  contextTaskId: string | null;
  matterTitle: string | null;
  onRemoveFileChatPill: (id: string) => void;
  onRemoveTruthPill?: (id: string) => void;
  onClearFileChatPills: () => void;
  onClearTruthPills?: () => void;
  onClearMatter?: () => void;
  onClearTask?: () => void;
  /** Wave 3-C：会话级计划交接条 */
  planHandoffSummary?: string | null;
  onFillPlanHandoff?: () => void;
  onClearPlanHandoff?: () => void;
  /** 快审卡打开时收起改稿条，避免两套立场叠在一起。 */
  hideWordRevisionBar?: boolean;
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
    onComposeInputChange,
    queuedMessages,
    cancelQueuedMessage,
    fileChatPills,
    truthPills = [],
    contextMatterId,
    contextTaskId,
    matterTitle,
    onRemoveFileChatPill,
    onRemoveTruthPill,
    onClearFileChatPills,
    onClearTruthPills,
    onClearMatter,
    onClearTask,
    planHandoffSummary = null,
    onFillPlanHandoff,
    onClearPlanHandoff,
    hideWordRevisionBar = false,
  } = props;

  const privilegeTip = useMemo(() => {
    if (!isPrivilegeTipUiEnabled()) {
      return null;
    }
    return scanPrivilegeTip(composeInput ?? "");
  }, [composeInput]);

  return (
    <div className="lm-compose-chrome">
      {planHandoffSummary && onFillPlanHandoff ? (
        <div
          className="lm-callout lm-callout-info lm-plan-handoff-banner"
          role="status"
          data-testid="lm-plan-handoff-banner"
        >
          <p className="lm-callout-title">已保存执行计划</p>
          <p className="lm-callout-body lm-plan-handoff-summary" title={planHandoffSummary}>
            {planHandoffSummary}
          </p>
          <div className="lm-plan-handoff-actions">
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              data-testid="lm-plan-handoff-fill"
              onClick={() => onFillPlanHandoff()}
            >
              填入交办
            </button>
            {onClearPlanHandoff ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                data-testid="lm-plan-handoff-clear"
                onClick={() => onClearPlanHandoff()}
              >
                清除
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
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
            {onOpenApiWizard && onOpenComposeSettings ? (
              <>
                {" "}
                <button
                  type="button"
                  className="lm-link-btn"
                  onClick={() => onOpenComposeSettings()}
                >
                  模型设置
                </button>
              </>
            ) : null}
          </p>
          <div className="lm-compose-model-warn-actions">
            {onOpenApiWizard ? (
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onOpenApiWizard()}>
                配置模型
              </button>
            ) : onOpenComposeSettings ? (
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={() => onOpenComposeSettings()}>
                配置模型
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
          <span className="lm-meta">排队 {queuedMessages.length} 条</span>
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
      {onComposeInputChange && !hideWordRevisionBar ? (
        <LawmindWordRevisionBar
          composeInput={composeInput ?? ""}
          filePills={fileChatPills}
          onComposeInputChange={onComposeInputChange}
        />
      ) : null}
      <LawmindSpreadsheetHintBar filePills={fileChatPills} />
      <LawmindComposeAttachments
        filePills={fileChatPills}
        truthPills={truthPills}
        contextMatterId={contextMatterId}
        contextTaskId={contextTaskId}
        matterTitle={matterTitle}
        onRemoveFilePill={onRemoveFileChatPill}
        onRemoveTruthPill={onRemoveTruthPill}
        onClearFilePills={onClearFileChatPills}
        onClearTruthPills={onClearTruthPills}
        onClearMatter={onClearMatter}
        onClearTask={onClearTask}
      />
    </div>
  );
}
