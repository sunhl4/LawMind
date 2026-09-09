/**
 * Compose toolbar: permission/options, model picker, write-materials, send/stop.
 * Extracted from lawmind-chat-shell (R-P1-2).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LawmindModelPicker } from "./LawmindModelPicker";
import {
  LawmindComposeContextUsage,
  type CompactPreview,
  type ComposeContextBudget,
} from "./LawmindComposeContextUsage";
import {
  readExecutePermissionMode,
  writeExecutePermissionMode,
  type ComposePermissionMode,
} from "./lawmind-compose-prefs";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import { LawmindDeskWorkPanel } from "./LawmindDeskWorkPanel";
import { requestOpenMeetingView } from "./lawmind-meeting-nav-bus";

export type LawmindChatComposeToolbarProps = {
  loading: boolean;
  input: string;
  onSend: () => void | Promise<void>;
  /** While a turn is running: queue this text as the next full turn (not a mid-turn correction). */
  onEnqueueNextTurn?: () => void | Promise<void>;
  onAbortChat?: () => void;
  permissionMode: ComposePermissionMode;
  onPermissionModeChange: (mode: ComposePermissionMode) => void;
  /**
   * When set, 「开始执行」calls this instead of only switching mode
   * (Plan→Execute handoff: inject confirm prompt from last plan).
   */
  onStartExecuteFromPlan?: () => void;
  allowWebSearch: boolean;
  webSearchPolicyBlocked?: boolean;
  onAllowWebSearchChange: (value: boolean) => void;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect?: (modelId: string) => void | Promise<void>;
  onOpenComposeSettings?: () => void;
  onOpenApiWizard?: () => void;
  onComposeModelQuickTest?: () => void | Promise<void>;
  composeModelQuickTestBusy?: boolean;
  onOpenWriteMaterials: () => void;
  onFillComposer?: (prompt: string) => void;
  /** 已有附件 / 钉源：办件里的合同审查 / 检索可直接锁流程。 */
  hasMaterials?: boolean;
  onCreateMatter?: () => void;
  onOpenWorkflows?: () => void;
  contextBudget?: ComposeContextBudget | null;
  compactBusy?: boolean;
  compactHint?: string | null;
  onCompactContext?: () => void | Promise<void>;
  onDistillLearning?: () => void | Promise<void>;
  onPreviewCompact?: () => Promise<CompactPreview | null>;
  onOpenMemoryInspector?: () => void;
  /** 本地 API base，用于加载仪表盘等数据。 */
  apiBase?: string;
};

export function LawmindChatComposeToolbar(props: LawmindChatComposeToolbarProps): ReactNode {
  const {
    loading,
    input,
    onSend,
    onEnqueueNextTurn,
    onAbortChat,
    permissionMode,
    onPermissionModeChange,
    onStartExecuteFromPlan,
    allowWebSearch,
    webSearchPolicyBlocked,
    onAllowWebSearchChange,
    modelCatalog,
    selectedModelId,
    onModelSelect,
    onOpenComposeSettings,
    onOpenApiWizard,
    onComposeModelQuickTest,
    composeModelQuickTestBusy,
    onOpenWriteMaterials,
    onFillComposer,
    hasMaterials = false,
    onCreateMatter,
    onOpenWorkflows,
    contextBudget = null,
    compactBusy = false,
    compactHint = null,
    onCompactContext,
    onDistillLearning,
    onPreviewCompact,
    onOpenMemoryInspector,
    apiBase,
  } = props;

  const [composeOptionsOpen, setComposeOptionsOpen] = useState(false);
  const [deskWorkOpen, setDeskWorkOpen] = useState(false);
  const composeOptionsRef = useRef<HTMLDivElement | null>(null);
  const deskWorkRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!composeOptionsOpen && !deskWorkOpen) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (
        !t ||
        composeOptionsRef.current?.contains(t) ||
        deskWorkRef.current?.contains(t)
      ) {
        return;
      }
      setComposeOptionsOpen(false);
      setDeskWorkOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposeOptionsOpen(false);
        setDeskWorkOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [composeOptionsOpen, deskWorkOpen]);

  return (
    <div className="lm-compose-toolbar" aria-label="模型与发送">
      <div className="lm-compose-toolbar-start">
        {permissionMode === "readonly" ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-small"
            data-testid="lm-compose-start-execute"
            disabled={loading}
            title="按计划开始执行"
            onClick={() => {
              if (onStartExecuteFromPlan) {
                onStartExecuteFromPlan();
                return;
              }
              onPermissionModeChange(readExecutePermissionMode());
            }}
          >
            开始执行
          </button>
        ) : null}
        {permissionMode === "strict" ? (
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-small"
            data-testid="lm-compose-restore-standard"
            disabled={loading}
            title="改回标准权限"
            onClick={() => {
              writeExecutePermissionMode("standard");
              onPermissionModeChange("standard");
            }}
          >
            恢复标准
          </button>
        ) : null}
        <div className="lm-compose-options" ref={composeOptionsRef}>
          <button
            type="button"
            className="lm-compose-plus-btn"
            aria-label="输入选项"
            aria-expanded={composeOptionsOpen}
            aria-haspopup="dialog"
            title="联网与其它选项"
            onClick={() => {
              setDeskWorkOpen(false);
              setComposeOptionsOpen((v) => !v);
            }}
          >
            <span aria-hidden>+</span>
          </button>
          <div
            className="lm-compose-options-panel"
            role="dialog"
            aria-label="输入选项"
            hidden={!composeOptionsOpen}
          >
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">权限</span>
              <select
                className="lm-compose-select"
                value={permissionMode}
                aria-label="工具权限模式"
                data-testid="lm-compose-permission-mode"
                disabled={loading}
                onChange={(e) => onPermissionModeChange(e.target.value as ComposePermissionMode)}
              >
                <option value="readonly">先计划</option>
                <option value="research">仅调研</option>
                <option value="standard">标准</option>
                <option value="strict">严格审批</option>
              </select>
            </label>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">联网</span>
              <select
                className="lm-compose-select"
                value={allowWebSearch ? "web" : "local"}
                disabled={Boolean(webSearchPolicyBlocked) || loading}
                aria-label="联网工具"
                title={
                  webSearchPolicyBlocked
                    ? "工作区策略已禁止联网检索"
                    : allowWebSearch
                      ? "已开启：助手可联网搜索"
                      : "关闭：仅使用工作区、案件记忆与本地工具"
                }
                onChange={(e) => onAllowWebSearchChange(e.target.value === "web")}
              >
                <option value="local">仅本地</option>
                <option value="web">联网</option>
              </select>
            </label>
            <button
              type="button"
              className="lm-compose-options-action"
              data-testid="lm-compose-open-meeting"
              disabled={loading}
              onClick={() => {
                setComposeOptionsOpen(false);
                requestOpenMeetingView();
              }}
            >
              <span className="lm-compose-options-action-k" aria-hidden>
                议
              </span>
              会议室
            </button>
            {loading && input.trim() && onEnqueueNextTurn ? (
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-small"
                data-testid="lm-compose-enqueue-next"
                aria-label="下一轮再发"
                title="followup：等本轮结束后再作为新一轮发送（不是中途 steer）"
                onClick={() => {
                  setComposeOptionsOpen(false);
                  void onEnqueueNextTurn();
                }}
              >
                下一轮再发
              </button>
            ) : null}
          </div>
        </div>
        <LawmindModelPicker
          catalog={modelCatalog}
          selectedModelId={selectedModelId}
          onSelect={(id) => onModelSelect?.(id)}
          onOpenSettings={onOpenComposeSettings}
          onOpenApiWizard={onOpenApiWizard}
          onTestCurrent={onComposeModelQuickTest}
          quickTestBusy={composeModelQuickTestBusy}
          disabled={loading}
          disabledTitle={loading ? "回复生成中，请稍后再切换模型" : undefined}
        />
        {contextBudget &&
        onCompactContext &&
        onDistillLearning &&
        (contextBudget.level === "warn" || contextBudget.level === "compact") ? (
          <LawmindComposeContextUsage
            budget={contextBudget}
            compactBusy={compactBusy}
            compactHint={compactHint}
            disabled={loading}
            onCompact={onCompactContext}
            onDistill={onDistillLearning}
            onPreviewCompact={onPreviewCompact}
            onOpenMemory={onOpenMemoryInspector}
          />
        ) : null}
        <div className="lm-compose-desk-work" ref={deskWorkRef}>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-small lm-compose-templates-btn"
            data-testid="lm-compose-desk-work"
            aria-label="办件"
            aria-expanded={deskWorkOpen}
            aria-haspopup="menu"
            title="先附材料，再选流程"
            onClick={() => {
              setComposeOptionsOpen(false);
              setDeskWorkOpen((v) => !v);
            }}
          >
            办件
          </button>
          <div className="lm-compose-desk-work-pop" hidden={!deskWorkOpen}>
            <LawmindDeskWorkPanel
              onFillComposer={(prompt) => {
                onFillComposer?.(prompt);
              }}
              onOpenWriteMaterials={onOpenWriteMaterials}
              onCreateMatter={onCreateMatter}
              onOpenWorkflows={onOpenWorkflows}
              hasMaterials={hasMaterials}
              onPick={() => setDeskWorkOpen(false)}
              apiBase={apiBase}
            />
          </div>
        </div>
      </div>
      <div className="lm-compose-toolbar-end">
        {loading ? (
          <>
            {input.trim() ? (
              <button
                type="button"
                className="lm-btn"
                aria-label="发送"
                title="带入本轮，不必等结束再重讲"
                onClick={() => void onSend()}
              >
                发送
              </button>
            ) : null}
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-chat-stop-btn"
              aria-label="停止生成"
              title="停止对话输出；若已关联指派任务会尽量一并取消"
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
            aria-label="发送消息"
            title={!input.trim() ? "请输入内容后再发送" : undefined}
            onClick={() => void onSend()}
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
