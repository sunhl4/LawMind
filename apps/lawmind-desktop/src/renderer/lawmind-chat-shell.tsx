import type { RefObject, ReactNode } from "react";
import { LawmindMemorySourcesPanel } from "./LawmindMemorySourcesPanel";
import type { ChatMsg } from "./lawmind-chat";

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
  return (message.memorySources?.length ?? 0) > 0 || (message.toolCallSequence?.length ?? 0) > 0;
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
  onClearContext: () => void;
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
  onClearContext,
}: Props) {
  return (
    <>
      <div className="lm-messages">
        {currentMessages.length === 0 ? (
          <div className="lm-messages-empty">
            <div className="lm-messages-empty-icon">L</div>
            <div className="lm-messages-empty-title">有什么可以帮您？</div>
            <div className="lm-messages-empty-hint">描述您的需求，我来协助起草、检索或分析。</div>
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

      <div className="lm-compose">
        {error && <div className="lm-error">{error}</div>}
        {contextTaskId && (
          <div className="lm-context-banner">
            <span>
              当前上下文：任务 <strong>{contextTaskId}</strong>
              {contextMatterId ? (
                <>
                  {" "}
                  · 案件 <strong>{contextMatterId}</strong>
                </>
              ) : null}
            </span>
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onClearContext}>
              清除
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
            placeholder="描述您的法律需求…"
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
              title="勾选后本轮对话注册 web_search 工具（Brave Search API），与聊天模型配置独立"
            >
              <input
                type="checkbox"
                checked={allowWebSearch}
                onChange={(e) => onAllowWebSearchChange(e.target.checked)}
              />
              <span>
                联网检索
                {webSearchApiKeyConfigured === false && (
                  <span style={{ color: "var(--warn)" }}> {" - "}未配置 API Key</span>
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
  );
}
