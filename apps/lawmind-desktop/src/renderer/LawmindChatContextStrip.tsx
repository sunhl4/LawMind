/**
 * 对话页顶栏：一眼说清「谁在答、为哪个案件、读哪份材料」。
 */

import type { ChatRuntimeHints } from "./lawmind-chat";

type Props = {
  assistantName: string;
  matterId: string | null;
  /** 来自案件 API 的 headline，缺省时仅展示 id */
  matterTitle: string | null;
  projectBasename: string | null;
  onOpenSettings: () => void;
  onGoToMatters: () => void;
  onClearContext: () => void;
  hasContext: boolean;
  /** 最近一轮助手答复若含服务端诊断则展示（Solo 需在设置中打开，或事务所版自动附带）。 */
  runtimeHints?: ChatRuntimeHints | null;
};

export function LawmindChatContextStrip({
  assistantName,
  matterId,
  matterTitle,
  projectBasename,
  onOpenSettings,
  onGoToMatters,
  onClearContext,
  hasContext,
  runtimeHints = null,
}: Props) {
  const matterLine =
    matterId == null
      ? "未选择"
      : matterTitle
        ? `${matterTitle}（${matterId}）`
        : matterId;

  return (
    <div className="lm-chat-context-head">
      <div className="lm-chat-context-strip" role="region" aria-label="当前在用什么资料">
        <div className="lm-chat-context-strip-items">
          <span
            className="lm-chat-context-pill"
            title="在左侧选中的工作智能体，决定分工与语气；可在设置里管理多个"
          >
            <span className="lm-chat-context-pill-k">智能体</span>
            {assistantName}
          </span>
          <span
            className="lm-chat-context-pill"
            title="先选案件，助手才能对上本案材料与客户信息。在「案件」页点「在对话中关联本案」可设置"
          >
            <span className="lm-chat-context-pill-k">案件</span>
            {matterLine}
          </span>
          <span
            className="lm-chat-context-pill"
            title="您允许智能体读取的办案材料所在文件夹；未选仍可对话，但少用本地文档"
          >
            <span className="lm-chat-context-pill-k">材料</span>
            {projectBasename ?? "未选文件夹"}
          </span>
        </div>
        <div className="lm-chat-context-strip-actions">
          {matterId == null ? (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-small" onClick={onGoToMatters}>
              去选案件
            </button>
          ) : null}
          {hasContext ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-small"
              onClick={onClearContext}
              title="取消与当前任务、案件的随对话关联"
            >
              取消关联
            </button>
          ) : null}
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-small" onClick={onOpenSettings}>
            设置
          </button>
        </div>
      </div>
      {runtimeHints ? (
        <div
          className="lm-chat-runtime-hints"
          role="status"
          aria-label="本轮路由与工具调用摘要"
          title="来自上一则助手答复：当前路由模式、推理模式与本轮工具调用次数"
        >
          <span className="lm-chat-runtime-hints-k">本轮</span>
          <span className="lm-chat-runtime-hints-sep" aria-hidden>
            ·
          </span>
          <span>路由 {runtimeHints.lawmindRouterMode}</span>
          <span className="lm-chat-runtime-hints-sep" aria-hidden>
            ·
          </span>
          <span>推理 {runtimeHints.lawmindReasoningMode}</span>
          <span className="lm-chat-runtime-hints-sep" aria-hidden>
            ·
          </span>
          <span>工具 {runtimeHints.toolCallsExecuted} 次</span>
        </div>
      ) : null}
    </div>
  );
}
