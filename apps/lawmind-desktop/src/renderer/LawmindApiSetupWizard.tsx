import { useState, type ReactNode } from "react";
import { lawmindDocUrl } from "./lawmind-public-urls.js";

type RetrievalMode = "single" | "dual";

/** One-click recommended stacks for lawyers (not power users). */
const RECOMMENDED_STACKS: Array<{
  id: string;
  label: string;
  hint: string;
  baseUrl: string;
  model: string;
}> = [
  {
    id: "deepseek",
    label: "DeepSeek Flash（推荐）",
    hint: "日常法律对话默认",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-flash",
  },
  {
    id: "qwen",
    label: "通义千问",
    hint: "DashScope 备选",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    id: "openai",
    label: "OpenAI 兼容",
    hint: "自备网关",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
];

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
  onSave: (opts?: { webSearchApiKey?: string }) => void;
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
  const [wizWebSearchApiKey, setWizWebSearchApiKey] = useState("");

  return (
    <div className="lm-wizard-backdrop" role="dialog" aria-modal="true" aria-label="LawMind 首次配置">
      <div className="lm-wizard">
        <h2>欢迎使用 LawMind</h2>
        <p className="lm-wizard-lead lm-settings-hint">
          填好 API Key，点一次推荐方案即可开始。保存时会写入本机{" "}
          <code className="lm-md-code">.env.lawmind</code>，并真实调用一次模型验证。
        </p>
        <div className="lm-wizard-recommended" role="group" aria-label="推荐模型">
          <span className="lm-meta">一键选用</span>
          <div className="lm-wizard-recommended-row">
            {RECOMMENDED_STACKS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`lm-btn lm-btn-secondary lm-btn-sm${
                  wizModel === s.model ? " lm-btn-selected" : ""
                }`}
                title={s.hint}
                onClick={() => {
                  setWizBaseUrl(s.baseUrl);
                  setWizModel(s.model);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <label className="lm-field">
          <span>API Key</span>
          <input
            type="password"
            autoComplete="off"
            value={wizApiKey}
            onChange={(e) => setWizApiKey(e.target.value)}
            placeholder={
              wizHasExistingKey ? "留空则保留已保存的 Key" : "粘贴 Key 即可，配合上方推荐方案"
            }
          />
        </label>
        <details className="lm-wizard-advanced" open={!wizBaseUrl && !wizModel}>
          <summary className="lm-meta">进阶：手动填写 Base URL / 模型名</summary>
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
        </details>
        <label className="lm-field">
          <span>工作区目录（可选）</span>
          <div className="lm-wizard-row">
            <input type="text" readOnly value={wizWorkspace} placeholder="默认：用户数据/LawMind/workspace" />
            <button type="button" className="lm-btn lm-btn-secondary" onClick={onPickWorkspace}>
              浏览…
            </button>
          </div>
        </label>
        <p className="lm-meta lm-settings-hint">默认检索与对话共用上方模型。接法律垂类时再关掉开关。</p>
        <details className="lm-wizard-advanced">
          <summary className="lm-meta">高级：检索策略</summary>
          <div className="lm-settings-row">
            <span className="lm-settings-key">检索与对话共用同一模型</span>
            <label className="lm-switch">
              <input
                type="checkbox"
                role="switch"
                data-testid="lm-wizard-share-retrieval"
                aria-checked={wizRetrievalMode !== "dual"}
                aria-label="检索与对话共用同一模型"
                checked={wizRetrievalMode !== "dual"}
                onChange={(e) => setWizRetrievalMode(e.target.checked ? "single" : "dual")}
              />
              <span className="lm-switch-ui" aria-hidden="true" />
            </label>
          </div>
          <p className="lm-meta lm-settings-hint">
            {wizRetrievalMode === "dual"
              ? "已分开：对话用上方模型。保存后请到「设置 → 模型/API」选择法律垂类检索模型。"
              : "开启：对话、法律检索、公开网页都用上方模型。"}
          </p>
          <label className="lm-field">
            <span>可选：独立网页检索（Brave）</span>
            <input
              type="password"
              autoComplete="off"
              value={wizWebSearchApiKey}
              onChange={(e) => setWizWebSearchApiKey(e.target.value)}
              placeholder="DeepSeek / 通义不用填；仅当当前模型没有厂商网页检索时才需要"
            />
          </label>
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
            onClick={() =>
              onSave({
                webSearchApiKey: wizWebSearchApiKey.trim() || undefined,
              })
            }
          >
            {wizBusy ? "验证并保存…" : "验证并保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
