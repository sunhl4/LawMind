/**
 * Compose toolbar: permission/options, model picker, write-materials, send/stop.
 * Extracted from lawmind-chat-shell (R-P1-2).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LawmindModelPicker } from "./LawmindModelPicker";
import type { ComposePermissionMode } from "./lawmind-compose-prefs";
import type { ModelCatalogEntry } from "./lawmind-models-api";

export type LawmindChatComposeToolbarProps = {
  loading: boolean;
  input: string;
  onSend: () => void | Promise<void>;
  onAbortChat?: () => void;
  permissionMode: ComposePermissionMode;
  onPermissionModeChange: (mode: ComposePermissionMode) => void;
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
};

export function LawmindChatComposeToolbar(props: LawmindChatComposeToolbarProps): ReactNode {
  const {
    loading,
    input,
    onSend,
    onAbortChat,
    permissionMode,
    onPermissionModeChange,
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
  } = props;

  const [composeOptionsOpen, setComposeOptionsOpen] = useState(false);
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
        <div className="lm-compose-options" ref={composeOptionsRef}>
          <button
            type="button"
            className="lm-compose-plus-btn"
            aria-label="输入选项"
            aria-expanded={composeOptionsOpen}
            aria-haspopup="dialog"
            title="权限、联网与模式"
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
                aria-label="工具权限模式"
                disabled={loading}
                onChange={(e) => onPermissionModeChange(e.target.value as ComposePermissionMode)}
              >
                <option value="standard">标准</option>
                <option value="strict">严格</option>
                <option value="readonly">只读</option>
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
                      ? "已开启：助手可调用 web_search（Brave）"
                      : "关闭：仅使用工作区、案件记忆与本地工具"
                }
                onChange={(e) => onAllowWebSearchChange(e.target.value === "web")}
              >
                <option value="local">仅本地</option>
                <option value="web">联网</option>
              </select>
            </label>
            <label className="lm-compose-bar-field">
              <span className="lm-compose-bar-label">模式</span>
              <select
                className="lm-compose-select"
                value="chat"
                aria-label="运行模式"
                title="当前仅对话模式已接入；Plan 多步编排尚未接线"
              >
                <option value="chat">对话</option>
                <option value="plan" disabled>
                  Plan（未接入）
                </option>
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
