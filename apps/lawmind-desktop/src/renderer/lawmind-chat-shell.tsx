import type { RefObject, ReactNode } from "react";
import { useState } from "react";
import { LawmindClarificationForm } from "./LawmindClarificationForm";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { getPendingClarificationState, handleEnterSendShiftNewline, type ChatMsg } from "./lawmind-chat";
import { DESK_VERBS } from "../../../../src/lawmind/desk/verbs.ts";
import { useHumanWaitLine } from "./lawmind-human-wait";
import {
  LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
  LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
} from "./lawmind-panel-layout";
import { usePaneResizeVerticalPx } from "./use-pane-resize";
import { internalIdsTitle } from "./display-ids";

/** 底部「模型」下拉：打开设置 */
const COMPOSE_MODEL_OPEN_SETTINGS = "__lawmind_compose_settings__";

const QUICK_ACTIONS = DESK_VERBS.map((card) => ({
  label: card.label,
  prompt: card.prompt,
}));

const SCENARIO_CARDS = DESK_VERBS.map((card) => ({
  title: card.label,
  description: card.description,
  prompt: card.prompt,
}));

function renderInlineLegalMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRe = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <code key={`code-${match.index}`} className="lm-md-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function renderLegalMarkdown(text: string): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      blocks.push(<div key={`space-${index}`} className="lm-md-space" />);
      index += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} className="lm-md-hr" />);
      index += 1;
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      blocks.push(
        <div key={`h2-${index}`} className="lm-md-h2">
          {renderInlineLegalMarkdown(h2[1])}
        </div>,
      );
      index += 1;
      continue;
    }

    const bullet = /^-\s+(.+)$/.exec(line);
    if (bullet) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const bulletMatch = /^-\s+(.+)$/.exec(lines[index] ?? "");
        if (!bulletMatch) {
          break;
        }
        items.push(
          <li key={`ul-item-${index}`}>{renderInlineLegalMarkdown(bulletMatch[1])}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`} className="lm-md-list">
          {items}
        </ul>,
      );
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const orderedMatch = /^\d+\.\s+(.+)$/.exec(lines[index] ?? "");
        if (!orderedMatch) {
          break;
        }
        items.push(
          <li key={`ol-item-${index}`}>{renderInlineLegalMarkdown(orderedMatch[1])}</li>,
        );
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`} className="lm-md-list lm-md-ol">
          {items}
        </ol>,
      );
      continue;
    }

    blocks.push(
      <div key={`p-${index}`} className="lm-md-p">
        {renderInlineLegalMarkdown(line)}
      </div>,
    );
    index += 1;
  }

  return <>{blocks}</>;
}

export function hasChatDiagnostics(message: ChatMsg): boolean {
  return (
    (message.memorySources?.length ?? 0) > 0 ||
    (message.toolCallSequence?.length ?? 0) > 0 ||
    message.runtimeHints != null
  );
}

function hasClarificationQuestions(message: ChatMsg): boolean {
  return (message.clarificationQuestions?.length ?? 0) > 0;
}

function shouldShowClarifyCard(message: ChatMsg): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  return hasClarificationQuestions(message) || message.status === "awaiting_clarification";
}

export type LawmindChatWorkspaceProps = {
  selectedAssistantId: string;
  currentMessages: ChatMsg[];
  copiedMessageIndex: number | null;
  input: string;
  loading: boolean;
  error: string | null;
  allowWebSearch: boolean;
  webSearchApiKeyConfigured?: boolean;
  contextTaskId: string | null;
  contextMatterId: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onInputChange: (value: string) => void;
  onAllowWebSearchChange: (value: boolean) => void;
  onSend: () => void | Promise<void>;
  /** 请求进行中时中止当前对话请求（与「发送」同位切换为「停止」） */
  onAbortChat?: () => void;
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onApplyPrompt: (prompt: string) => void;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  onClearContext: () => void;
  /** 关联案件标题（可空） */
  matterTitle: string | null;
  /** 在「文件」页标记的、将拼入发送给模型的路径引用 */
  fileChatPills: Array<{ id: string; shortLabel: string; title: string }>;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
  /** 打开设置（模型/API、联网密钥等） */
  onOpenComposeSettings?: () => void;
  /** 主模型是否已在环境中配置；未加载 health 时可不传 */
  composeModelConfigured?: boolean;
  /** Solo 不展示尚未落地的 Plan 模式 */
  showPlanPicker?: boolean;
  /** Word/WPS 侧车待处理选区 */
  sidecarNotice?: ReactNode;
  /** 关闭输入区错误条（不删对话里的失败气泡） */
  onDismissError?: () => void;
};

export type LawmindChatMessagesColumnProps = Pick<
  LawmindChatWorkspaceProps,
  | "selectedAssistantId"
  | "currentMessages"
  | "copiedMessageIndex"
  | "loading"
  | "messagesEndRef"
  | "onCopyMessage"
  | "onApplyPrompt"
  | "onSendClarificationMessage"
  | "fileChatPills"
  | "onRemoveFileChatPill"
  | "onClearFileChatPills"
>;

function lastUserMessageText(messages: ChatMsg[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (row?.role === "user" && row.text.trim()) {
      return row.text;
    }
  }
  return "";
}

export function LawmindChatMessagesColumn({
  selectedAssistantId,
  currentMessages,
  copiedMessageIndex,
  loading,
  messagesEndRef,
  onCopyMessage,
  onApplyPrompt,
  onSendClarificationMessage,
  fileChatPills,
  onRemoveFileChatPill,
  onClearFileChatPills,
}: LawmindChatMessagesColumnProps) {
  const pendingClarify = getPendingClarificationState(currentMessages);
  const waitLine = useHumanWaitLine(loading, lastUserMessageText(currentMessages));

  return (
    <>
      {fileChatPills.length > 0 ? (
        <div className="lm-file-chat-context-bar" role="region" aria-label="本对话引用的文件与目录">
          <span className="lm-file-chat-context-k">引用</span>
          <div className="lm-file-chat-context-chips">
            {fileChatPills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                className="lm-file-chat-chip"
                title={`${pill.title}（点击移除）`}
                onClick={() => onRemoveFileChatPill(pill.id)}
              >
                {pill.shortLabel}
                <span className="lm-file-chat-chip-x" aria-hidden>
                  ×
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onClearFileChatPills}>
            清空引用
          </button>
        </div>
      ) : null}
      <div className="lm-messages" role="region" aria-label="对话消息">
        {currentMessages.length === 0 ? (
          <div className="lm-messages-empty">
            <div className="lm-messages-empty-icon">L</div>
            <div className="lm-messages-empty-title">开始对话</div>
            <div className="lm-scenario-cards">
              {SCENARIO_CARDS.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  className="lm-scenario-card"
                  onClick={() => onApplyPrompt(card.prompt)}
                >
                  <span className="lm-scenario-title">{card.title}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          currentMessages.map((msg, index) => (
            <div
              key={`${selectedAssistantId}-msg-${index}`}
              className={`lm-msg-row ${msg.role === "user" ? "lm-msg-row-user" : ""}`}
            >
              <div
                className={`lm-msg-avatar ${
                  msg.role === "user" ? "lm-msg-avatar-user" : "lm-msg-avatar-ai"
                }`}
              >
                {msg.role === "user" ? "我" : "LM"}
              </div>
              <div className={`lm-msg-wrap ${msg.role === "user" ? "lm-msg-wrap-user" : ""}`}>
                <div className={`lm-msg ${msg.role === "user" ? "lm-msg-user" : "lm-msg-ai"}`}>
                  {msg.role === "assistant" ? renderLegalMarkdown(msg.text) : msg.text}
                </div>
                {msg.role === "assistant" && (
                  <button
                    type="button"
                    className="lm-msg-copy-btn"
                    onClick={() => void onCopyMessage(msg.text, index)}
                  >
                    {copiedMessageIndex === index ? "已复制 ✓" : "复制"}
                  </button>
                )}
                {msg.role === "assistant" && shouldShowClarifyCard(msg) && (
                  <div
                    className="lm-clarify-card"
                    id={`lm-clarify-card-${index}`}
                    data-testid={index === pendingClarify.assistantMessageIndex ? "lm-clarify-card-active" : undefined}
                  >
                    <div className="lm-clarify-card-title">
                      {msg.status === "awaiting_clarification" ? "还差这些信息" : "建议补充这些"}
                    </div>
                    <div className="lm-clarify-card-hint">
                      {msg.status === "awaiting_clarification" && (msg.clarificationQuestions?.length ?? 0) === 0
                        ? "请补充说明后发送。"
                        : msg.status === "awaiting_clarification"
                          ? "请填毕下方各项。"
                          : "可在大框说明后发送。"}
                    </div>
                    {(msg.clarificationQuestions?.length ?? 0) > 0 ? (
                      <LawmindClarificationForm
                        formKey={`${selectedAssistantId}-${index}`}
                        questions={msg.clarificationQuestions ?? []}
                        loading={loading}
                        onApplyToInput={onApplyPrompt}
                        onSend={onSendClarificationMessage}
                      />
                    ) : (
                      <p className="lm-clarify-card-fallback">请在下方输入并发送。</p>
                    )}
                  </div>
                )}
                {msg.role === "assistant" && hasChatDiagnostics(msg) && (
                  <LawmindMemorySourcesPanel
                    layers={msg.memorySources ?? []}
                    toolCallSequence={msg.toolCallSequence}
                    variant="chat"
                  />
                )}
              </div>
            </div>
          ))
        )}
        {loading ? (
          <div className="lm-msg-row" data-testid="lm-human-wait">
            <div className="lm-msg-avatar lm-msg-avatar-ai">LM</div>
            <div className="lm-msg-wrap">
              <div className="lm-msg lm-msg-ai lm-human-wait" role="status" aria-live="polite">
                {waitLine}
              </div>
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
      </div>
    </>
  );
}

/** 底部输入区：始终显示在主工作区底栏（可拖高度） */
export function LawmindChatComposeFooter({
  currentMessages,
  input,
  loading,
  error,
  contextTaskId,
  contextMatterId,
  matterTitle,
  textareaRef,
  onInputChange,
  onSend,
  onAbortChat,
  onApplyPrompt,
  onClearContext,
  onOpenComposeSettings,
  composeModelConfigured,
  showPlanPicker = true,
  sidecarNotice,
  onDismissError,
}: Pick<
  LawmindChatWorkspaceProps,
  | "currentMessages"
  | "input"
  | "loading"
  | "error"
  | "contextTaskId"
  | "contextMatterId"
  | "matterTitle"
  | "textareaRef"
  | "onInputChange"
  | "onSend"
  | "onAbortChat"
  | "onApplyPrompt"
  | "onClearContext"
  | "onOpenComposeSettings"
  | "composeModelConfigured"
  | "showPlanPicker"
  | "sidecarNotice"
  | "onDismissError"
>) {
  const [modelPick, setModelPick] = useState("default");
  const { height: composeHeight, onResizePointerDown: onComposeResizePointerDown } = usePaneResizeVerticalPx({
    storageKey: "lawmind.ui.chatComposeHeight",
    defaultHeight: LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
    min: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
    max: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  });

  const pendingClarify = getPendingClarificationState(currentMessages);
  const waitLine = useHumanWaitLine(loading, lastUserMessageText(currentMessages));
  const scrollToClarifyCard = () => {
    if (pendingClarify.assistantMessageIndex < 0) {
      return;
    }
    const id = `lm-clarify-card-${pendingClarify.assistantMessageIndex}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <>
      <div
        className="lm-split-handle lm-split-handle-horizontal"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整输入区高度"
        title="拖动调整消息区与输入区比例"
        onPointerDown={onComposeResizePointerDown}
      />
      <div
        className="lm-compose lm-compose-resizable"
        style={{
          height: composeHeight,
          flexShrink: 0,
          minHeight: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
          maxHeight: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
        }}
      >
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
            {onDismissError ? (
              <button
                type="button"
                className="lm-error-dismiss"
                aria-label="关闭错误提示"
                onClick={onDismissError}
              >
                关闭
              </button>
            ) : null}
          </div>
        ) : null}
        {sidecarNotice ?? null}
        {pendingClarify.pending && (
          <div className="lm-clarify-session-bar" role="status">
            <span className="lm-clarify-session-bar-text">
              {pendingClarify.count > 0
                ? `请先补全下面 ${pendingClarify.count} 项，我才能继续。`
                : "请先就上面的待确认点说清，我才能继续。"}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary lm-clarify-session-bar-jump" onClick={scrollToClarifyCard}>
              去填写处
            </button>
          </div>
        )}
        {contextMatterId && !contextTaskId ? (
          <div
            className="lm-context-banner"
            title={internalIdsTitle([{ label: "案件编号", value: contextMatterId }])}
          >
            <span>
              当前对话已关联案件。
              {matterTitle ? ` ${matterTitle}` : ""}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
              取消关联
            </button>
          </div>
        ) : null}
        {contextTaskId ? (
          <div
            className="lm-context-banner"
            title={internalIdsTitle([
              { label: "任务编号", value: contextTaskId },
              { label: "案件编号", value: contextMatterId ?? undefined },
            ])}
          >
            <span>
              当前对话已关联案件工作台中的一条草稿。
              {matterTitle ? `（${matterTitle}）` : ""}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
              不跟这个了
            </button>
          </div>
        ) : null}

        <div className="lm-chip-row">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              className="lm-chip"
              onClick={() => onApplyPrompt(action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>

        <div className="lm-compose-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            placeholder="Enter 发送，Shift+Enter 换行"
            title="用平常说话的方式写即可"
            onKeyDown={(e) => handleEnterSendShiftNewline(e, () => void onSend())}
          />
          <div className="lm-compose-toolbar" aria-label="模式、模型与发送">
            <div className="lm-compose-toolbar-start">
              {showPlanPicker ? (
                <label className="lm-compose-bar-field">
                  <span className="lm-compose-bar-label">模式</span>
                  <select className="lm-compose-select" value="chat" aria-label="运行模式" title="Plan 等多步编排将陆续提供">
                    <option value="chat">对话</option>
                    <option value="plan" disabled>
                      Plan（即将推出）
                    </option>
                  </select>
                </label>
              ) : null}
              <label className="lm-compose-bar-field">
                <span className="lm-compose-bar-label">模型</span>
                <select
                  className="lm-compose-select"
                  value={modelPick}
                  aria-label="模型与 API"
                  title="选择默认对话模型或打开设置"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === COMPOSE_MODEL_OPEN_SETTINGS) {
                      onOpenComposeSettings?.();
                      setModelPick("default");
                      return;
                    }
                    setModelPick(v);
                  }}
                >
                  <option value="default">
                    {composeModelConfigured === false ? "默认模型（API 未配置）" : "默认对话模型"}
                  </option>
                  <option value={COMPOSE_MODEL_OPEN_SETTINGS}>模型与 API…</option>
                </select>
              </label>
            </div>
            <div className="lm-compose-toolbar-end">
              {loading ? (
                <>
                  <span className="lm-human-wait-compose" role="status" aria-live="polite">
                    {waitLine}
                  </span>
                  <button
                    type="button"
                    className="lm-btn lm-btn-secondary lm-chat-stop-btn"
                    onClick={() => onAbortChat?.()}
                  >
                    停止
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="lm-btn"
                  disabled={!input.trim()}
                  onClick={() => void onSend()}
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function LawmindChatShell(props: LawmindChatWorkspaceProps) {
  return (
    <div className="lm-chat-workspace">
      <LawmindChatMessagesColumn {...props} />
      <LawmindChatComposeFooter
        currentMessages={props.currentMessages}
        input={props.input}
        loading={props.loading}
        error={props.error}
        contextTaskId={props.contextTaskId}
        contextMatterId={props.contextMatterId}
        matterTitle={props.matterTitle}
        textareaRef={props.textareaRef}
        onInputChange={props.onInputChange}
        onSend={props.onSend}
        onAbortChat={props.onAbortChat}
        onApplyPrompt={props.onApplyPrompt}
        onClearContext={props.onClearContext}
        onOpenComposeSettings={props.onOpenComposeSettings}
        composeModelConfigured={props.composeModelConfigured}
        showPlanPicker={props.showPlanPicker}
        sidecarNotice={props.sidecarNotice}
        onDismissError={props.onDismissError}
      />
    </div>
  );
}
