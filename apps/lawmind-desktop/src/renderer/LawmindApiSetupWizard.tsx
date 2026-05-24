import type { ReactNode } from "react";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

type RetrievalMode = "single" | "dual";

type Props = {
  wizApiKey: string;
  setWizApiKey: (v: string) => void;
  /** When true, saving with an empty key field keeps the existing key on disk. */
  wizHasExistingKey?: boolean;
  wizBaseUrl: string;
  setWizBaseUrl: (v: string) => void;
  wizModel: string;
  setWizModel: (v: string) => void;
  wizWorkspace: string;
  wizRetrievalMode: RetrievalMode;
  setWizRetrievalMode: (m: RetrievalMode) => void;
  wizError: string | null;
  wizBusy: boolean;
  onPickWorkspace: () => void;
  onCancel: () => void;
  onSave: () => void;
};

/**
 * First-run / settings entry: model API and optional workspace path (writes user .env.lawmind via bridge).
 */
export function LawmindApiSetupWizard(props: Props): ReactNode {
  const {
    wizApiKey,
    setWizApiKey,
    wizHasExistingKey = false,
    wizBaseUrl,
    setWizBaseUrl,
    wizModel,
    setWizModel,
    wizWorkspace,
    wizRetrievalMode,
    setWizRetrievalMode,
    wizError,
    wizBusy,
    onPickWorkspace,
    onCancel,
    onSave,
  } = props;

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 首次配置">
      <div className="lm-wizard">
        <h2>欢迎使用 LawMind</h2>
        <p className="lm-wizard-lead lm-settings-hint">
          请配置模型 API。保存时会写入本机用户目录下的{" "}
          <code className="lm-md-code">.env.lawmind</code>（下次打开无需重填），并<strong>真实调用</strong>
          一次模型接口验证 Key 是否可用；验证通过后才算配置完成。
        </p>
        <label className="lm-field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={wizApiKey}
            onChange={(e) => setWizApiKey(e.target.value)}
            placeholder={
              wizHasExistingKey ? "留空则保留已保存的 Key" : "LAWMIND / Qwen / DashScope 等"
            }
          />
        </label>
        <label className="lm-field">
          <span>Base URL（可选）</span>
          <input
            type="text"
            value={wizBaseUrl}
            onChange={(e) => setWizBaseUrl(e.target.value)}
            placeholder="OpenAI-compatible /v1"
          />
        </label>
        <label className="lm-field">
          <span>模型名（可选）</span>
          <input type="text" value={wizModel} onChange={(e) => setWizModel(e.target.value)} />
        </label>
        <label className="lm-field">
          <span>工作区目录（可选）</span>
          <div className="lm-wizard-row">
            <input type="text" readOnly value={wizWorkspace} placeholder="默认：用户数据/LawMind/workspace" />
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onPickWorkspace}>
              浏览…
            </button>
          </div>
        </label>
        <p className="lm-meta lm-settings-hint">
          检索策略默认与上方模型共用同一套 API；如需法律专用检索，可在高级选项中切换。
        </p>
        <details className="lm-wizard-advanced">
          <summary className="lm-meta">高级：检索策略（引擎 research / 工作流）</summary>
          <fieldset className="lm-field lm-field-reset">
            <label className="lm-field-radio lm-field-radio-row">
              <input
                type="radio"
                name="wiz-retrieval"
                checked={wizRetrievalMode === "single"}
                onChange={() => setWizRetrievalMode("single")}
              />
              <span>统一模型 — 通用与法律检索用同一套 API</span>
            </label>
            <label className="lm-field-radio">
              <input
                type="radio"
                name="wiz-retrieval"
                checked={wizRetrievalMode === "dual"}
                onChange={() => setWizRetrievalMode("dual")}
              />
              <span>
                通用 + 法律专用 — 通用用上方 Key；法律检索需在 <code>.env.lawmind</code> 配置{" "}
                <code>LAWMIND_CHATLAW_*</code> / <code>LAWMIND_LAWGPT_*</code> 等（未配时仍回退为通用模型）。
              </span>
            </label>
          </fieldset>
        </details>
        {wizError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{wizError}</p>
          </div>
        ) : null}
        <div className="lm-callout lm-callout-muted" role="note">
          <p className="lm-callout-body">
            LawMind 输出为辅助草稿，不构成法律意见；专业判断与对外交付由律师负责。详见文档{" "}
            <a href={lawmindDocUrl("legal/terms-of-service")} target="_blank" rel="noreferrer noopener">
              条款草案
            </a>
            。
          </p>
        </div>
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" onClick={onCancel} disabled={wizBusy}>
            稍后
          </button>
          <button
            type="button"
            className="lm-btn"
            disabled={wizBusy || (!wizApiKey.trim() && !wizHasExistingKey)}
            onClick={onSave}
          >
            {wizBusy ? "验证并保存…" : "验证并保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
