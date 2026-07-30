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
  readShowToolTrace,
  writeExecutePermissionMode,
  writeShowToolTrace,
  type ComposePermissionMode,
} from "./lawmind-compose-prefs";
import type { ModelCatalogEntry } from "./lawmind-models-api";

export type LawmindChatComposeToolbarProps = {
  loading: boolean;
  input: string;
  onSend: () => void | Promise<void>;
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
  /** When false, Brave key missing — disable「联网」and guide to settings. */
  webSearchApiKeyConfigured?: boolean;
  onAllowWebSearchChange: (value: boolean) => void;
  modelCatalog: ModelCatalogEntry[];
  selectedModelId: string;
  onModelSelect?: (modelId: string) => void | Promise<void>;
  onOpenComposeSettings?: () => void;
  onOpenApiWizard?: () => void;
  onComposeModelQuickTest?: () => void | Promise<void>;
  composeModelQuickTestBusy?: boolean;
  onOpenWriteMaterials: () => void;
  contextBudget?: ComposeContextBudget | null;
  compactBusy?: boolean;
  compactHint?: string | null;
  onCompactContext?: () => void | Promise<void>;
  onDistillLearning?: () => void | Promise<void>;
  onPreviewCompact?: () => Promise<CompactPreview | null>;
  onOpenMemoryInspector?: () => void;
};

export function LawmindChatComposeToolbar(props: LawmindChatComposeToolbarProps): ReactNode {
  const {
    loading,
    input,
    onSend,
    onAbortChat,
    permissionMode,
    onPermissionModeChange,
    onStartExecuteFromPlan,
    allowWebSearch,
    webSearchPolicyBlocked,
    webSearchApiKeyConfigured = true,
    onAllowWebSearchChange,
    modelCatalog,
    selectedModelId,
    onModelSelect,
    onOpenComposeSettings,
    onOpenApiWizard,
    onComposeModelQuickTest,
    composeModelQuickTestBusy,
    onOpenWriteMaterials,
    contextBudget = null,
    compactBusy = false,
    compactHint = null,
    onCompactContext,
    onDistillLearning,
    onPreviewCompact,
    onOpenMemoryInspector,
  } = props;

  const [composeOptionsOpen, setComposeOptionsOpen] = useState(false);
  const [showToolTrace, setShowToolTrace] = useState(() => readShowToolTrace());
  const composeOptionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!composeOptionsOpen) {
      return;
    }
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node | null;
      if (!t || composeOptionsRef.current?.contains(t)) {
        return;
      }
      setComposeOptionsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setComposeOptionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [composeOptionsOpen]);

  return (
    <div className="lm-compose-toolbar" aria-label="模型与发送">
      <div className="lm-compose-toolbar-start">
        <label className="lm-compose-bar-field lm-compose-permission-inline">
          <span className="lm-compose-bar-label">权限</span>
          <select
            className="lm-compose-select"
            value={permissionMode}
            aria-label="工具权限模式"
            data-testid="lm-compose-permission-mode"
            disabled={loading}
            title={
              permissionMode === "readonly"
                ? "先计划：只检索与分析，不写盘；确认后再执行（默认严格审批）"
                : permissionMode === "research"
                  ? "仅调研：只读工具 + research_task，不可起草/渲染/工作流"
                  : permissionMode === "strict"
                    ? "严格审批：危险工具必须先拍板"
                    : "标准：可按策略调用工具"
            }
            onChange={(e) => onPermissionModeChange(e.target.value as ComposePermissionMode)}
          >
            <option value="readonly">先计划</option>
            <option value="research">仅调研</option>
            <option value="standard">标准</option>
            <option value="strict">严格审批</option>
          </select>
        </label>
        {permissionMode === "readonly" ? (
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-small"
            data-testid="lm-compose-start-execute"
            disabled={loading}
            title="切换到执行权限并带入计划确认交办，允许起草与写盘"
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
            title="改回标准权限（危险工具仍可能按策略要求批准）"
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
            onClick={() => setComposeOptionsOpen((v) => !v)}
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
                aria-label="工具权限模式（详细）"
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
                disabled={
                  Boolean(webSearchPolicyBlocked) || !webSearchApiKeyConfigured || loading
                }
                aria-label="联网工具"
                title={
                  webSearchPolicyBlocked
                    ? "工作区策略已禁止联网检索"
                    : !webSearchApiKeyConfigured
                      ? "未配置联网密钥：请在设置 → 模型与检索中配置联网密钥"
                      : allowWebSearch
                        ? "已开启：助手可联网检索（Brave）"
                        : "关闭：仅使用工作区、案件记忆与本地工具"
                }
                onChange={(e) => onAllowWebSearchChange(e.target.value === "web")}
              >
                <option value="local">仅本地</option>
                <option value="web">联网</option>
              </select>
            </label>
            <span className="lm-compose-bar-field" title="当前为对话模式；多步流程请用「写材料」或在办「按流程」">
              <span className="lm-compose-bar-label">模式</span>
              <span className="lm-compose-mode-chip" data-testid="lm-compose-mode-chat">
                对话
              </span>
            </span>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">工具轨迹</span>
              <select
                className="lm-compose-select"
                value={showToolTrace ? "on" : "off"}
                disabled={loading}
                aria-label="显示工具轨迹"
                data-testid="lm-compose-show-tool-trace"
                title="展开助手消息中的工具步骤与轨迹"
                onChange={(e) => {
                  const on = e.target.value === "on";
                  setShowToolTrace(on);
                  writeShowToolTrace(on);
                }}
              >
                <option value="off">折叠</option>
                <option value="on">展开</option>
              </select>
            </label>
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
        {onCompactContext && onDistillLearning ? (
          <LawmindComposeContextUsage
            budget={contextBudget ?? null}
            compactBusy={compactBusy}
            compactHint={compactHint}
            disabled={loading}
            onCompact={onCompactContext}
            onDistill={onDistillLearning}
            onPreviewCompact={onPreviewCompact}
            onOpenMemory={onOpenMemoryInspector}
          />
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small lm-compose-templates-btn"
          data-testid="lm-compose-write-materials"
          title="打开模板库：填表交办文书与材料"
          aria-label="写材料，打开填表交办"
          onClick={() => {
            setComposeOptionsOpen(false);
            onOpenWriteMaterials();
          }}
        >
          写材料
        </button>
      </div>
      <div className="lm-compose-toolbar-end">
        {loading ? (
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-chat-stop-btn"
            aria-label="停止生成"
            title="停止对话输出；若已关联指派任务会尽量一并取消"
            onClick={() => onAbortChat?.()}
          >
            停止
          </button>
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
