/**
 * 记忆来源面板 — 对话 / 审核台共用，符合常见「上下文 / Sources」信息架构。
 * 对话模式可在折叠上方展示摘要 chip（记忆 + 按调用顺序的工具步骤）。
 */

import { useId, useState } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

const LAWMIND_USER_MANUAL = lawmindDocUrl("LAWMIND-USER-MANUAL");

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
  const engineClient = layers.filter((l) => l.activeForEngine).length;
  return { inPrompt, present, total: layers.length, engineClient };
}

function clientProfileChipText(layers: MemorySourceLayer[]): { text: string; title: string } {
  const row = layers.find((l) => l.activeForEngine);
  if (!row) {
    return { text: "已用客户档案", title: "本段对话已按您指定的客户长期档案作答" };
  }
  const norm = row.relativePath.replace(/\\/g, "/");
  const m = /clients\/([^/]+)\//.exec(norm);
  if (m) {
    return {
      text: `客户档案：${m[1]}`,
      title: `本段对话引用的客户档案：${m[1]}`,
    };
  }
  if (row.id === "client_profile_root" || norm.endsWith("CLIENT_PROFILE.md")) {
    return {
      text: "客户档案：默认",
      title: "使用工作区里默认的客户总档案",
    };
  }
  return { text: "已用客户档案", title: "本段对话已按您指定的客户长期档案作答" };
}

function ChatChipStrip(props: {
  layers: MemorySourceLayer[];
  toolCallSequence: string[];
  /** 对话里用短句、少术语；审核台可保留更密的标签 */
  plain: boolean;
}) {
  const { layers, toolCallSequence, plain } = props;
  const s = summarize(layers);
  const profileChip = clientProfileChipText(layers);
  const hasMem = layers.length > 0;
  const hasTools = toolCallSequence.length > 0;
  if (!hasMem && !hasTools) {
    return null;
  }
  return (
    <div className="lm-context-chip-strip" aria-label="本回答参考摘要">
      {hasMem && (
        <>
          <span className="lm-context-chip lm-context-chip--memory" title="本次回答纳入考虑的资料类数">
            {plain ? `${s.total} 类材料` : `${s.total} 层记忆`}
          </span>
          <span
            className="lm-context-chip lm-context-chip--memory lm-context-chip--accent"
            title={plain ? "已把这部分写进给助手的总说明" : "已进入本助手主提示（system prompt）"}
          >
            {plain ? `${s.inPrompt} 已写入说明` : `${s.inPrompt} 已注入提示`}
          </span>
          {s.engineClient > 0 ? (
            <span
              className="lm-context-chip lm-context-chip--memory lm-context-chip--engine"
              title={profileChip.title}
            >
              {profileChip.text}
            </span>
          ) : null}
          <span className="lm-context-chip lm-context-chip--memory" title="在电脑上找到对应文件">
            {plain ? `${s.present} 个已找到` : `${s.present} 文件在盘`}
          </span>
        </>
      )}
      {hasTools && !plain && (
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
      {hasTools && plain ? (
        <span
          className="lm-context-chip lm-context-chip--tool lm-context-chip--plain-steps"
          title={toolCallSequence.join(" → ")}
        >
          {toolCallSequence.length} 个处理步骤
        </span>
      ) : null}
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
  const hasMissingFile = layers.some((l) => !l.exists);

  const plain = variant === "chat";
  const showChatStrip = variant === "chat" && (hasMemoryTable || hasTools);
  const showWorkbenchBadges = variant === "workbench";

  const sectionLabel = plain
    ? hasMemoryTable
      ? "本回答引用的材料"
      : "本回答的处理步骤"
    : hasMemoryTable
      ? hasTools
        ? "本轮记忆、上下文与工具调用"
        : "本轮记忆与上下文来源"
      : "本轮工具调用";

  return (
    <section className={`lm-context-panel lm-context-panel--${variant}`} aria-label={sectionLabel}>
      {showChatStrip && <ChatChipStrip layers={layers} toolCallSequence={toolCallSequence} plain />}

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
            <span className="lm-context-panel-title">
              {plain ? "本回答引用了哪些材料" : "上下文来源"}
            </span>
            {showWorkbenchBadges && (
              <span className="lm-context-panel-badges" aria-hidden>
                <span className="lm-badge-soft">{summary.total} 层</span>
                <span className="lm-badge-soft lm-badge-soft--accent">{summary.inPrompt} 已注入提示</span>
                {summary.engineClient > 0 ? (
                  <span className="lm-badge-soft lm-badge-soft--engine">客户画像·本回合</span>
                ) : null}
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
              {plain
                ? "一般不必逐行看。需要核对时再看：哪些写进了给助手的总说明、本段话实际用到哪条客户信息。"
                : "以下为工作区 Markdown 真相源。标记为「已注入提示」的内容已进入本助手 system prompt；「本回合」表示与当前引擎记忆（含客户画像源）选中的行一致，该内容会同步供模型检索 RAG 使用。其余可能通过检索或工具间接使用。"}
            </p>
            <div className="lm-context-table-wrap lm-context-table-wrap--responsive">
              <table className="lm-context-table">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      title={plain ? "如：总所规则、某案件、某客户" : "在工作区中的逻辑角色，例如工作区级、案件级、客户级"}
                    >
                      {plain ? "哪一类" : "来源"}
                    </th>
                    <th scope="col" title={plain ? "在电脑工作区里的位置" : "相对工作区根的路径"}>
                      {plain ? "位置" : "路径"}
                    </th>
                    <th scope="col" title={plain ? "文件是否在您电脑上" : "该文件在磁盘上是否存在"}>
                      状态
                    </th>
                    <th
                      scope="col"
                      title={plain ? "是否整段放进了给助手的总说明" : "是否已整段进入本助手 system prompt"}
                    >
                      {plain ? "总说明" : "提示词"}
                    </th>
                    <th
                      scope="col"
                      title={plain ? "本段回答是否按这条客户资料来" : "与当轮引擎记忆（含 RAG 客户画像选行）是否一致"}
                    >
                      {plain ? "本段" : "本回合"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {layers.map((m) => (
                    <tr
                      key={`${m.id}::${m.relativePath}`}
                      className={m.activeForEngine ? "lm-context-tr--engine" : undefined}
                    >
                      <td data-label={plain ? "哪一类" : "来源"}>
                        <div className="lm-context-label-stack">
                          <span className="lm-context-cell-label">{m.label}</span>
                          {m.hint ? (
                            <span className="lm-context-cell-sublabel" title={m.hint}>
                              {m.hint}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td data-label={plain ? "位置" : "路径"}>
                        <code className="lm-context-path" title={m.relativePath}>
                          {m.relativePath}
                        </code>
                      </td>
                      <td data-label="状态">
                        <span className={m.exists ? "lm-pill lm-pill--ok" : "lm-pill lm-pill--muted"}>
                          {m.exists ? "已存在" : "缺失"}
                        </span>
                      </td>
                      <td data-label={plain ? "总说明" : "提示词"}>
                        <span
                          className={
                            m.inAgentSystemPrompt ? "lm-pill lm-pill--accent" : "lm-pill lm-pill--muted"
                          }
                        >
                          {m.inAgentSystemPrompt ? "已注入" : "未注入"}
                        </span>
                      </td>
                      <td data-label={plain ? "本段" : "本回合"}>
                        <span
                          className={
                            m.activeForEngine ? "lm-pill lm-pill--engine" : "lm-pill lm-pill--muted"
                          }
                          title={
                            m.activeForEngine ? (plain ? "本段回答按此条客户信息" : "本回合客户画像：与引擎与检索使用的文件一致") : undefined
                          }
                        >
                          {m.activeForEngine ? "生效" : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hasMissingFile ? (
              <p className="lm-context-missing-hint">
                {plain
                  ? "若有「未找到」：请在工作区里建好文件，并确认已选对「材料」文件夹和案件。"
                  : "若有行显示为「缺失」，请检查工作区是否已建立对应文件、项目目录与案件是否选对。说明见"}{" "}
                {!plain ? (
                  <>
                    <a className="lm-link-inline" href={LAWMIND_USER_MANUAL} target="_blank" rel="noreferrer">
                      LawMind 用户手册
                    </a>
                    。
                  </>
                ) : (
                  <>
                    {" "}
                    <a className="lm-link-inline" href={LAWMIND_USER_MANUAL} target="_blank" rel="noreferrer">
                      查看说明
                    </a>
                  </>
                )}
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
