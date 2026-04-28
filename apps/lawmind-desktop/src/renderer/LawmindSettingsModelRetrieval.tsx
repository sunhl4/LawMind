import { useCallback, useState, type ChangeEvent, type ReactNode } from "react";
import {
  readIncludeTurnDiagnostics,
  writeIncludeTurnDiagnostics,
} from "./lawmind-chat-diagnostics-pref.ts";
import type { LawmindSettingsAppConfig, LawmindSettingsHealth } from "./lawmind-settings-models.ts";

type Props = {
  config: LawmindSettingsAppConfig;
  health: LawmindSettingsHealth;
  retrievalLabel: string;
  retrievalSaving: boolean;
  applyRetrievalMode: (mode: "single" | "dual") => void;
  onOpenApiWizard: () => void;
};

export function LawmindSettingsModelRetrieval(props: Props): ReactNode {
  const { config, health, retrievalLabel, retrievalSaving, applyRetrievalMode, onOpenApiWizard } = props;
  const [turnDiagnostics, setTurnDiagnostics] = useState(readIncludeTurnDiagnostics);
  const onTurnDiagnosticsChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    writeIncludeTurnDiagnostics(next);
    setTurnDiagnostics(next);
  }, []);

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">模型与检索</div>
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型状态</span>
          <span className={health?.modelConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
            {health?.modelConfigured ? "已配置" : "待配置"}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">检索策略</span>
          <span className="lm-settings-val">{retrievalLabel}</span>
        </div>
        <div className="lm-retrieval-block">
          <label className="lm-radio-row">
            <input
              type="radio"
              name="retrieval-mode"
              checked={config.retrievalMode === "single"}
              disabled={retrievalSaving}
              onChange={() =>  applyRetrievalMode("single")}
            />
            <span>统一模型</span>
          </label>
          <label className="lm-radio-row">
            <input
              type="radio"
              name="retrieval-mode"
              checked={config.retrievalMode === "dual"}
              disabled={retrievalSaving}
              onChange={() =>  applyRetrievalMode("dual")}
            />
            <span>通用 + 法律专用</span>
          </label>
          {config.retrievalMode === "dual" && health?.dualLegalConfigured === false && (
            <div className="lm-callout lm-callout-warn" role="status">
              <p className="lm-callout-body">法律专用端点未配置，当前仍会回退到通用模型。</p>
            </div>
          )}
          {retrievalSaving ? (
            <div className="lm-callout lm-callout-info" role="status" aria-live="polite">
              <p className="lm-callout-body">正在切换并重启服务…</p>
            </div>
          ) : null}
        </div>
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
            API 配置向导
          </button>
        </div>
        <label className="lm-radio-row lm-settings-diagnostics-toggle">
          <input
            type="checkbox"
            checked={turnDiagnostics}
            onChange={onTurnDiagnosticsChange}
          />
          <span>
            对话调试信息：在响应中附带路由模式与本轮工具调用摘要（独立律师版默认关闭；事务所版通常已自动展示）
          </span>
        </label>
      </div>
    </div>
  );
}
