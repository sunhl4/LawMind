import type { ReactNode } from "react";
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
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">模型与检索</div>
      <div className="lm-settings-group">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型状态</span>
          <span className={health?.modelConfigured ? "lm-dot lm-dot-ok" : "lm-dot lm-dot-warn"}>
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
            <div className="lm-meta">法律专用端点未配置，当前仍会回退到通用模型。</div>
          )}
          {retrievalSaving && <div className="lm-meta">正在切换并重启服务…</div>}
        </div>
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onOpenApiWizard}>
            API 配置向导
          </button>
        </div>
      </div>
    </div>
  );
}
