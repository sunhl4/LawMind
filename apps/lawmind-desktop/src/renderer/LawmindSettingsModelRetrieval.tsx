import { useCallback, useState, type ChangeEvent, type ReactNode } from "react";
import {
  readIncludeTurnDiagnostics,
  writeIncludeTurnDiagnostics,
} from "./lawmind-chat-diagnostics-pref.ts";
import { LawmindSettingsCustomModels } from "./LawmindSettingsCustomModels";
import {
  testModelConnection,
  type ModelCatalogEntry,
  type PlatformProviderKeyStatus,
  type ProviderKeyStatus,
} from "./lawmind-models-api";
import type { LawmindSettingsAppConfig, LawmindSettingsHealth } from "./lawmind-settings-models.ts";
import { isSelectedModelVerified } from "./lawmind-model-verify";

type Props = {
  config: LawmindSettingsAppConfig;
  health: LawmindSettingsHealth;
  envFilePath?: string;
  apiBase?: string;
  modelProviders?: ProviderKeyStatus[];
  platformProviders?: PlatformProviderKeyStatus[];
  platformMode?: "proxy" | "platform_key" | "none";
  selectedModelId?: string;
  customModels?: ModelCatalogEntry[];
  modelCatalog?: ModelCatalogEntry[];
  onModelsChanged?: () => void | Promise<void>;
  retrievalLabel: string;
  retrievalSaving: boolean;
  draftWithModelSaving?: boolean;
  applyRetrievalMode: (mode: "single" | "dual") => void;
  applyDraftWithModelEnabled?: (enabled: boolean) => void | Promise<void>;
  onOpenApiWizard: () => void;
};

export function LawmindSettingsModelRetrieval(props: Props): ReactNode {
  const {
    config,
    health,
    envFilePath,
    apiBase,
    modelProviders = [],
    platformProviders = [],
    platformMode = "none",
    selectedModelId = "",
    customModels = [],
    modelCatalog = [],
    onModelsChanged,
    retrievalLabel,
    retrievalSaving,
    draftWithModelSaving = false,
    applyRetrievalMode,
    applyDraftWithModelEnabled,
    onOpenApiWizard,
  } = props;
  const [turnDiagnostics, setTurnDiagnostics] = useState(readIncludeTurnDiagnostics);
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<string | null>(null);
  const onTurnDiagnosticsChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    writeIncludeTurnDiagnostics(next);
    setTurnDiagnostics(next);
  }, []);

  const onTestModel = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setModelTestBusy(true);
    setModelTestResult(null);
    try {
      const body = await testModelConnection(apiBase, selectedModelId || "");
      setModelTestResult(
        `连接成功：${body.model ?? "—"} · ${body.latencyMs ?? "?"}ms · ${body.modelId ?? ""}`,
      );
      if (onModelsChanged) {
        await onModelsChanged();
      }
    } catch (cause) {
      setModelTestResult(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModelTestBusy(false);
    }
  }, [apiBase, onModelsChanged, selectedModelId]);

  const modelOk =
    Boolean(health?.modelConfigured) && isSelectedModelVerified(modelCatalog, selectedModelId);

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">模型与检索</div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型</span>
          <span className={modelOk ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
            {!health?.modelConfigured
              ? "待配置"
              : isSelectedModelVerified(modelCatalog, selectedModelId)
                ? "已验证"
                : "待验证"}
          </span>
        </div>
        {health?.modelName ? (
          <div className="lm-settings-row">
            <span className="lm-settings-key">当前</span>
            <span className="lm-settings-val" title={health.modelName}>
              {health.modelName}
            </span>
          </div>
        ) : null}
        <div className="lm-settings-row">
          <span className="lm-settings-key">联网检索</span>
          <span
            className={
              health?.webSearchApiKeyConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
            }
          >
            {health?.webSearchApiKeyConfigured ? "已配置" : "未配置"}
          </span>
        </div>
        {envFilePath ? (
          <div className="lm-settings-row lm-settings-row-stack">
            <span className="lm-settings-key">配置文件</span>
            <code className="lm-md-code lm-settings-env-path">{envFilePath}</code>
          </div>
        ) : null}

        {!health?.modelConfigured ? (
          <p className="lm-settings-caption" role="status">
            请用「API 配置向导」写入密钥。
          </p>
        ) : health?.modelEnvFileExists === false ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="status">
            凭据可用但本机配置文件未写入，建议重新保存一次。
          </p>
        ) : null}

        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
            API 配置向导
          </button>
          {apiBase ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={modelTestBusy || !health?.modelConfigured}
              onClick={() => void onTestModel()}
            >
              {modelTestBusy ? "测试中…" : "测试连接"}
            </button>
          ) : null}
        </div>
        {modelTestResult ? (
          <p
            className={`lm-settings-caption ${modelTestResult.startsWith("连接成功") ? "lm-settings-caption--ok" : "lm-settings-caption--warn"}`}
            role="status"
          >
            {modelTestResult}
          </p>
        ) : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <label className="lm-settings-row lm-settings-row-check">
          <span className="lm-settings-key">起草使用大模型</span>
          <input
            type="checkbox"
            checked={health?.draftWithModelEnabled === true}
            disabled={!health?.modelConfigured || draftWithModelSaving || !applyDraftWithModelEnabled}
            aria-label="起草阶段使用大模型"
            onChange={(e) => {
              if (applyDraftWithModelEnabled) {
                void applyDraftWithModelEnabled(e.target.checked);
              }
            }}
          />
        </label>
        <p className="lm-settings-caption">
          {!health?.modelConfigured
            ? "需先配置模型"
            : "开启后用当前模型扩写；关闭则用规则模板。"}
        </p>
        {draftWithModelSaving ? (
          <p className="lm-settings-caption" role="status" aria-live="polite">
            正在保存…
          </p>
        ) : null}
        {health?.draftWithModelEnabled && health?.draftWithModelActive === false ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="status">
            已开启但凭据不可用，将回退规则模板。
          </p>
        ) : null}
      </div>

      <details className="lm-settings-advanced">
        <summary>高级：联网密钥、检索与自定义模型</summary>
        <div className="lm-settings-advanced-body">
          <p className="lm-settings-caption">
            联网检索需 Brave Key（
            <code className="lm-md-code">LAWMIND_WEB_SEARCH_API_KEY</code> 或{" "}
            <code className="lm-md-code">BRAVE_API_KEY</code>
            ），写入 <code className="lm-md-code">.env.lawmind</code> 后重启。
          </p>

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
                onChange={() => applyRetrievalMode("single")}
              />
              <span>统一模型</span>
            </label>
            <label className="lm-radio-row">
              <input
                type="radio"
                name="retrieval-mode"
                checked={config.retrievalMode === "dual"}
                disabled={retrievalSaving}
                onChange={() => applyRetrievalMode("dual")}
              />
              <span>通用 + 法律专用</span>
            </label>
            {config.retrievalMode === "dual" && health?.dualLegalConfigured === false ? (
              <p className="lm-settings-caption lm-settings-caption--warn" role="status">
                法律专用端点未配置，将回退通用模型。
              </p>
            ) : null}
            {retrievalSaving ? (
              <p className="lm-settings-caption" role="status" aria-live="polite">
                正在切换…
              </p>
            ) : null}
          </div>

          {platformMode !== "none" ? (
            <p className="lm-settings-caption" role="status">
              已启用组织提供的平台模型
              {platformMode === "proxy" ? "（代理）" : ""}
              {platformProviders.some((p) => p.configured)
                ? ` · 已开通 ${platformProviders.filter((p) => p.configured).length} 家`
                : ""}
            </p>
          ) : null}
          {modelProviders.length > 0 ? (
            <div className="lm-provider-key-grid" aria-label="本机 API Key 状态">
              {modelProviders.map((p) => (
                <div className="lm-settings-row" key={p.provider}>
                  <span className="lm-settings-key">{p.label}</span>
                  <span className={p.configured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
                    {p.configured ? "已配置" : "未配置"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {apiBase && onModelsChanged ? (
            <LawmindSettingsCustomModels
              apiBase={apiBase}
              customModels={customModels}
              onChanged={onModelsChanged}
            />
          ) : null}

          <label className="lm-settings-row lm-settings-row-check lm-settings-diagnostics-toggle">
            <span className="lm-settings-key">对话调试信息</span>
            <input type="checkbox" checked={turnDiagnostics} onChange={onTurnDiagnosticsChange} />
          </label>
        </div>
      </details>
    </div>
  );
}
