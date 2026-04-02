/**
 * 记忆来源面板 — 对话 / 审核台共用，符合常见「上下文 / Sources」信息架构。
 * 对话模式可在折叠上方展示摘要 chip（记忆 + 按调用顺序的工具步骤）。
 */

import { useId, useState } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";

type Props = {
  layers: MemorySourceLayer[];
  /** 对话：默认折叠；审核台：默认展开 */
  variant?: "chat" | "workbench";
  defaultOpen?: boolean;
  /** 本轮工具调用顺序（与 /api/chat 的 toolCallSequence 一致，一步一条） */
  toolCallSequence?: string[];
};

function summarize(layers: MemorySourceLayer[]) {
  const inPrompt = layers.filter((l) => l.inAgentSystemPrompt).length;
  const present = layers.filter((l) => l.exists).length;
  return { inPrompt, present, total: layers.length };
}

function ChatChipStrip(props: {
  layers: MemorySourceLayer[];
  toolCallSequence: string[];
}) {
  const { layers, toolCallSequence } = props;
  const s = summarize(layers);
  const hasMem = layers.length > 0;
  const hasTools = toolCallSequence.length > 0;
  if (!hasMem && !hasTools) {
    return null;
  }
  return (
    <div className="lm-context-chip-strip" aria-label="本轮摘要">
      {hasMem && (
        <>
          <span className="lm-context-chip lm-context-chip--memory">{s.total} 层记忆</span>
          <span className="lm-context-chip lm-context-chip--memory lm-context-chip--accent">
            {s.inPrompt} 已注入提示
          </span>
          <span className="lm-context-chip lm-context-chip--memory">{s.present} 文件在盘</span>
        </>
      )}
      {hasTools && (
        <ul className="lm-context-tool-steps" aria-label="工具调用顺序">
          {toolCallSequence.map((name, i) => (
            <li key={`${i}-${name}`} className="lm-context-tool-step">
              <span
                className="lm-context-chip lm-context-chip--tool"
                title={name}
                aria-label={`第 ${i + 1} 步：${name}`}
              >
                <span className="lm-context-chip-step-num" aria-hidden>
                  {i + 1}
                </span>
                <span className="lm-context-chip-tool-name">{name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LawmindMemorySourcesPanel(props: Props) {
  const { layers, variant = "chat", defaultOpen, toolCallSequence = [] } = props;
  const summary = summarize(layers);
  const panelId = useId();
  const [open, setOpen] = useState(
    defaultOpen !== undefined ? defaultOpen : variant === "workbench",
  );

  const hasMemoryTable = layers.length > 0;
  const hasTools = toolCallSequence.length > 0;
  if (!hasMemoryTable && !hasTools) {
    return null;
  }

  const showChatStrip = variant === "chat" && (hasMemoryTable || hasTools);
  const showWorkbenchBadges = variant === "workbench";

  const sectionLabel = hasMemoryTable
    ? hasTools
      ? "本轮记忆、上下文与工具调用"
      : "本轮记忆与上下文来源"
    : "本轮工具调用";

  return (
    <section className={`lm-context-panel lm-context-panel--${variant}`} aria-label={sectionLabel}>
      {showChatStrip && (
        <ChatChipStrip layers={layers} toolCallSequence={toolCallSequence} />
      )}

      {hasMemoryTable && (
        <>
          <button
            type="button"
            className={`lm-context-panel-trigger ${showChatStrip ? "lm-context-panel-trigger--chat-compact" : ""}`}
            aria-expanded={open}
            aria-controls={panelId}
            id={`${panelId}-trigger`}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="lm-context-panel-title">上下文来源</span>
            {showWorkbenchBadges && (
              <span className="lm-context-panel-badges" aria-hidden>
                <span className="lm-badge-soft">{summary.total} 层</span>
                <span className="lm-badge-soft lm-badge-soft--accent">{summary.inPrompt} 已注入提示</span>
                <span className="lm-badge-soft">{summary.present} 文件存在</span>
              </span>
            )}
            <span
              className={`lm-context-panel-chevron ${open ? "lm-context-panel-chevron--open" : ""}`}
              aria-hidden
            >
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
            <p className="lm-context-panel-hint">
              以下为工作区 Markdown 真相源。标记为「已注入提示」的内容已进入本助手 system prompt；其余可能通过检索或工具间接使用。
            </p>
            <div className="lm-context-table-wrap">
              <table className="lm-context-table">
                <thead>
                  <tr>
                    <th scope="col">来源</th>
                    <th scope="col">路径</th>
                    <th scope="col">状态</th>
                    <th scope="col">提示词</th>
                  </tr>
                </thead>
                <tbody>
                  {layers.map((m) => (
                    <tr key={m.id}>
                      <td className="lm-context-cell-label">{m.label}</td>
                      <td>
                        <code className="lm-context-path" title={m.relativePath}>
                          {m.relativePath}
                        </code>
                      </td>
                      <td>
                        <span className={m.exists ? "lm-pill lm-pill--ok" : "lm-pill lm-pill--muted"}>
                          {m.exists ? "已存在" : "缺失"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            m.inAgentSystemPrompt ? "lm-pill lm-pill--accent" : "lm-pill lm-pill--muted"
                          }
                        >
                          {m.inAgentSystemPrompt ? "已注入" : "未注入"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
