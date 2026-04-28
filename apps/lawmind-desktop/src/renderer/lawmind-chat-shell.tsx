import type { RefObject, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { ClarificationQuestion } from "../../../../src/lawmind/types.ts";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import { LawmindChatContextStrip } from "./LawmindChatContextStrip";
import {
  formatClarificationPromptSummary,
  formatClarificationReply,
  getPendingClarificationState,
  lastAssistantRuntimeHints,
  type ChatMsg,
} from "./lawmind-chat";
import {
  LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
  LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
} from "./lawmind-panel-layout";
import { usePaneResizeVerticalPx } from "./use-pane-resize";

const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  { label: "起草律师函", prompt: "请帮我起草一封律师函，就以下事项发出法律警告：\n\n" },
  { label: "合同审查", prompt: "请对以下合同进行风险审查，逐条标注重点风险点：\n\n" },
  { label: "法规检索", prompt: "请检索以下法律问题的相关法规、司法解释和典型判例：\n\n" },
  { label: "起草诉状", prompt: "请帮我起草民事起诉状，案情简述如下：\n\n" },
  { label: "案例查询", prompt: "请查找与以下纠纷类似的典型判例及裁判要旨：\n\n" },
];

const SCENARIO_CARDS: Array<{ title: string; description: string; prompt: string }> = [
  {
    title: "起草文书",
    description: "律师函、诉状、公函",
    prompt: "请帮我起草一份律师函，核心事实与诉求如下：\n\n",
  },
  {
    title: "法规检索",
    description: "条文、判例、政策文件",
    prompt: "请检索以下法律问题的相关法规、司法解释与裁判要旨：\n\n",
  },
  {
    title: "合同审查",
    description: "逐条标注风险与建议",
    prompt: "请对以下合同进行逐条审查，并列出关键风险点与修改建议：\n\n",
  },
];

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

function LawmindClarificationForm({
  formKey,
  questions,
  loading,
  onApplyToInput,
  onSend,
}: {
  formKey: string;
  questions: ClarificationQuestion[];
  loading: boolean;
  onApplyToInput: (text: string) => void;
  onSend: (text: string) => void | Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.key, ""])),
  );

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((q) => [q.key, ""])));
  }, [formKey]);

  const payload = formatClarificationReply(questions, answers);
  const canSubmit = payload.length > 0;
  const answeredCount = questions.filter(
    (q) => (typeof answers[q.key] === "string" ? answers[q.key].trim() : "") !== "",
  ).length;
  const totalCount = questions.length;
  const promptSummary = formatClarificationPromptSummary(questions);

  return (
    <>
      {totalCount > 0 ? (
        <p className="lm-clarify-form-progress" role="status" aria-label="填写进度">
          已答 {answeredCount} / {totalCount} 项
        </p>
      ) : null}
      <div className="lm-clarify-form-fields">
        {questions.map((item) => (
          <label key={item.key} className="lm-clarify-field">
            <span className="lm-clarify-field-label">{item.question}</span>
            {item.reason ? <span className="lm-clarify-field-reason">{item.reason}</span> : null}
            <textarea
              className="lm-clarify-field-input"
              rows={2}
              value={answers[item.key] ?? ""}
              placeholder="在此输入…"
              onChange={(e) => {
                const v = e.target.value;
                setAnswers((prev) => ({ ...prev, [item.key]: v }));
              }}
            />
          </label>
        ))}
      </div>
      <div className="lm-clarify-form-actions">
        {promptSummary ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-clarify-btn"
            disabled={loading}
            title="只把问题列表放到下面大框，方便您用习惯的方式写"
            onClick={() => onApplyToInput(promptSummary)}
          >
            只把问题列到下面
          </button>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-clarify-btn"
          disabled={!canSubmit || loading}
          title={!canSubmit ? "请先填至少一项" : undefined}
          onClick={() => onApplyToInput(payload)}
        >
          已填的放到下面
        </button>
        <button
          type="button"
          className="lm-btn lm-clarify-btn"
          disabled={!canSubmit || loading}
          title={!canSubmit ? "请先填至少一项" : undefined}
          onClick={() => void onSend(payload)}
        >
          填好并发送
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-clarify-btn"
          disabled={loading}
          onClick={() => setAnswers(Object.fromEntries(questions.map((q) => [q.key, ""])))}
        >
          清空
        </button>
      </div>
    </>
  );
}

type Props = {
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
  onCopyMessage: (text: string, index: number) => void | Promise<void>;
  onApplyPrompt: (prompt: string) => void;
  onSendClarificationMessage: (text: string) => void | Promise<void>;
  onClearContext: () => void;
  composeCollapsed: boolean;
  onToggleComposeCollapsed: () => void;
  /** 当前助手显示名 */
  assistantDisplayName: string;
  /** 关联案件标题（可空） */
  matterTitle: string | null;
  /** 主输入区上挂的项目目录名 */
  projectBasename: string | null;
  onOpenSettings: () => void;
  onGoToMatters: () => void;
  /** 在「文件」页标记的、将拼入发送给模型的路径引用 */
  fileChatPills: Array<{ id: string; shortLabel: string; title: string }>;
  onRemoveFileChatPill: (id: string) => void;
  onClearFileChatPills: () => void;
};

export function LawmindChatShell({
  selectedAssistantId,
  currentMessages,
  copiedMessageIndex,
  input,
  loading,
  error,
  allowWebSearch,
  webSearchApiKeyConfigured,
  contextTaskId,
  contextMatterId,
  textareaRef,
  messagesEndRef,
  onInputChange,
  onAllowWebSearchChange,
  onSend,
  onCopyMessage,
  onApplyPrompt,
  onSendClarificationMessage,
  onClearContext,
  composeCollapsed,
  onToggleComposeCollapsed,
  assistantDisplayName,
  matterTitle,
  projectBasename,
  onOpenSettings,
  onGoToMatters,
  fileChatPills,
  onRemoveFileChatPill,
  onClearFileChatPills,
}: Props) {
  const { height: composeHeight, onResizePointerDown: onComposeResizePointerDown } = usePaneResizeVerticalPx({
    storageKey: "lawmind.ui.chatComposeHeight",
    defaultHeight: LM_CHAT_COMPOSE_DEFAULT_HEIGHT_PX,
    min: LM_CHAT_COMPOSE_MIN_HEIGHT_PX,
    max: LM_CHAT_COMPOSE_MAX_HEIGHT_PX,
  });

  const pendingClarify = getPendingClarificationState(currentMessages);

  const scrollToClarifyCard = () => {
    if (pendingClarify.assistantMessageIndex < 0) {
      return;
    }
    const id = `lm-clarify-card-${pendingClarify.assistantMessageIndex}`;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const hasStripContext = Boolean(contextTaskId || contextMatterId);
  const stripRuntimeHints = lastAssistantRuntimeHints(currentMessages);
  return (
    <div className="lm-chat-workspace">
      <LawmindChatContextStrip
        assistantName={assistantDisplayName}
        matterId={contextMatterId}
        matterTitle={matterTitle}
        projectBasename={projectBasename}
        onOpenSettings={onOpenSettings}
        onGoToMatters={onGoToMatters}
        onClearContext={onClearContext}
        hasContext={hasStripContext}
        runtimeHints={stripRuntimeHints}
      />
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
            <div className="lm-messages-empty-title">需要我做什么？</div>
            <div className="lm-messages-empty-hint">
              左侧可换<strong>智能体</strong>（不同分工在「设置」里建）。先<strong>关联案件</strong>、在「文件」里引用材料，再向下说明要办的事。复杂流程可到「设置 → 协作」跑多步工作流；<strong>对外交付前请走「审核」</strong>。
            </div>
            <div className="lm-scenario-cards">
              {SCENARIO_CARDS.map((card) => (
                <button
                  key={card.title}
                  type="button"
                  className="lm-scenario-card"
                  onClick={() => onApplyPrompt(card.prompt)}
                >
                  <span className="lm-scenario-title">{card.title}</span>
                  <span className="lm-scenario-hint">{card.description}</span>
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
                        ? "请先在下框或底部输入里说明清楚，再点发送，我才能继续往下做。"
                        : msg.status === "awaiting_clarification"
                          ? "草稿已有；请把下面几项补全，填好后点「填好并发送」即可继续。"
                          : "正稿已起草；请把下面几项补全，或改在大框里说明后发送。"}
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
                      <p className="lm-clarify-card-fallback">请在下面输入里说明，再点「发送」继续。</p>
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
        <div ref={messagesEndRef} />
      </div>

      {!composeCollapsed ? (
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
              </div>
            ) : null}
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
            {contextTaskId && (
              <div className="lm-context-banner">
                <span>
                  正在跟进的任务 <strong>{contextTaskId}</strong>
                  {contextMatterId ? (
                    <>
                      {" "}
                      · 案件 <strong>{contextMatterId}</strong>
                    </>
                  ) : null}
                </span>
                <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
                  不跟这个了
                </button>
              </div>
            )}

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
                placeholder="用平常说话的方式写即可…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />
              <div className="lm-compose-footer">
                <label
                  className="lm-web-toggle"
                  title="勾选后需要时可上网查公开信息；未配置时此项不可用"
                >
                  <input
                    type="checkbox"
                    checked={allowWebSearch}
                    onChange={(e) => onAllowWebSearchChange(e.target.checked)}
                  />
                  <span>
                    需要时上网查
                    {webSearchApiKeyConfigured === false && (
                      <span className="lm-text-warn"> {" - "}未配置</span>
                    )}
                  </span>
                </label>
                <div className="lm-compose-actions">
                  <span className="lm-send-hint">⌘↵</span>
                  <button
                    type="button"
                    className="lm-btn"
                    disabled={loading || !input.trim()}
                    onClick={() => void onSend()}
                  >
                    {loading ? "处理中…" : "发送"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="lm-compose-collapsed-bar">
          {error ? (
            <div className="lm-callout lm-callout-danger lm-compose-collapsed-error" role="alert">
              <p className="lm-callout-body">{error}</p>
            </div>
          ) : null}
          {pendingClarify.pending ? (
            <div className="lm-clarify-session-bar lm-clarify-session-bar-collapsed" role="status">
              <span>
                {pendingClarify.count > 0
                  ? `还差 ${pendingClarify.count} 项没填 — 点展开输入，或到上面填`
                  : "还有事没对齐 — 先展开输入区，或到上面说清"}
              </span>
              <button type="button" className="lm-btn lm-btn-secondary lm-clarify-session-bar-jump" onClick={scrollToClarifyCard}>
                去填
              </button>
            </div>
          ) : null}
          <button type="button" className="lm-compose-collapsed-expand" onClick={onToggleComposeCollapsed}>
            展开输入区
          </button>
          <span className="lm-compose-collapsed-hint">已收起底部输入区</span>
        </div>
      )}
    </div>
  );
}
