import type { ReactNode } from "react";

type RetrievalMode = "single" | "dual";

type Props = {
  wizApiKey: string;
  setWizApiKey: (v: string) => void;
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
        <p className="lm-meta">请配置模型 API（写入用户目录下的 .env.lawmind），可选自定义工作区路径。</p>
        <label className="lm-field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={wizApiKey}
            onChange={(e) => setWizApiKey(e.target.value)}
            placeholder="LAWMIND / Qwen 等"
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
        <fieldset className="lm-field" style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="lm-meta" style={{ marginBottom: 8 }}>
            检索策略（引擎工具 research / 工作流）
          </legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input
              type="radio"
              name="wiz-retrieval"
              checked={wizRetrievalMode === "single"}
              onChange={() => setWizRetrievalMode("single")}
            />
            <span>统一模型 — 通用与法律检索用同一套 API</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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
        {wizError && <div className="lm-error">{wizError}</div>}
        <p className="lm-disclaimer">
          LawMind 输出为辅助草稿，不构成法律意见；专业判断与对外交付由律师负责。详见文档{" "}
          <a href="https://docs.openclaw.ai/legal/terms-of-service" target="_blank" rel="noreferrer noopener">
            条款草案
          </a>
          。
        </p>
        <div className="lm-wizard-actions">
          <button type="button" className="lm-btn lm-btn-secondary" onClick={onCancel} disabled={wizBusy}>
            稍后
          </button>
          <button
            type="button"
            className="lm-btn"
            disabled={wizBusy || !wizApiKey.trim()}
            onClick={onSave}
          >
            {wizBusy ? "保存中…" : "保存并重启服务"}
          </button>
        </div>
      </div>
    </div>
  );
}
