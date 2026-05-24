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

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">模型与检索</div>
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型状态</span>
          <span
            className={
              health?.modelConfigured && isSelectedModelVerified(modelCatalog, selectedModelId)
                ? "lm-pill lm-pill-success"
                : "lm-pill lm-pill-warn"
            }
          >
            {!health?.modelConfigured
              ? "待配置"
              : isSelectedModelVerified(modelCatalog, selectedModelId)
                ? "已验证"
                : "待验证"}
          </span>
        </div>
        {health?.modelName ? (
          <div className="lm-settings-row">
            <span className="lm-settings-key">当前模型</span>
            <span className="lm-settings-val">{health.modelName}</span>
          </div>
        ) : null}
        <div className="lm-settings-row">
          <span className="lm-settings-key">联网检索（Brave）</span>
          <span
            className={
              health?.webSearchApiKeyConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
            }
          >
            {health?.webSearchApiKeyConfigured ? "密钥已配置" : "未配置"}
          </span>
        </div>
        <p className="lm-meta lm-settings-hint">
          对话栏<strong>联网</strong>选「联网」（非「仅本地」）后，助手可调用 <code className="lm-md-code">web_search</code>
          （与聊天模型 API 独立）。请在用户目录 <code className="lm-md-code">.env.lawmind</code> 中增加{" "}
          <code className="lm-md-code">LAWMIND_WEB_SEARCH_API_KEY</code> 或{" "}
          <code className="lm-md-code">BRAVE_API_KEY</code>（
          <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer">
            Brave Search API
          </a>
          ），保存后重启应用。工作区 <code className="lm-md-code">lawmind.policy.json</code> 可将{" "}
          <code className="lm-md-code">allowWebSearch</code> 设为 <code className="lm-md-code">false</code>{" "}
          以禁止联网。
        </p>
        {envFilePath ? (
          <div className="lm-settings-row lm-settings-row-stack">
            <span className="lm-settings-key">配置文件</span>
            <code className="lm-md-code lm-settings-env-path">{envFilePath}</code>
          </div>
        ) : null}
        {!health?.modelConfigured ? (
          <div className="lm-callout lm-callout-warn" role="status">
            <p className="lm-callout-body">
              仅切换「检索策略」不会写入 API Key。请点击下方<strong> API 配置向导</strong>
              ，填写 Key 后选择<strong>验证并保存</strong>（写入本机用户目录的
              <code className="lm-md-code">.env.lawmind</code>，下次打开无需重填；安装版不会读取开发目录里的同名文件）。
            </p>
          </div>
        ) : health?.modelEnvFileExists === false ? (
          <div className="lm-callout lm-callout-warn" role="status">
            <p className="lm-callout-body">
              健康检查显示可用，但配置文件尚未写入本机用户目录。若对话仍失败，请重新打开 API
              配置向导保存一次。
            </p>
          </div>
        ) : null}
        <div className="lm-settings-row lm-settings-row-stack">
          <span className="lm-settings-key">起草阶段使用大模型</span>
          <label className="lm-radio-row">
            <input
              type="checkbox"
              checked={health?.draftWithModelEnabled === true}
              disabled={
                !health?.modelConfigured ||
                draftWithModelSaving ||
                !applyDraftWithModelEnabled
              }
              onChange={(e) => {
                if (applyDraftWithModelEnabled) {
                  void applyDraftWithModelEnabled(e.target.checked);
                }
              }}
            />
            <span>
              {!health?.modelConfigured
                ? "需先配置模型"
                : health?.draftWithModelEnabled
                  ? "已开启"
                  : "已关闭（规则模板）"}
            </span>
          </label>
        </div>
        {health?.modelConfigured ? (
          <p className="lm-meta lm-settings-draft-model-hint">
            开启后，工作流起草会复用当前对话模型的 API Key 扩写完整章节（ESG/长报告建议开启）；
            关闭则生成带 E/S/G 结构的规则框架与检索要点，无需单独配置 Key。
            若需检索与起草使用不同模型，可在环境变量中单独设置{" "}
            <code className="lm-md-code">LAWMIND_REASONING_*</code>。
          </p>
        ) : null}
        {draftWithModelSaving ? (
          <div className="lm-callout lm-callout-info" role="status" aria-live="polite">
            <p className="lm-callout-body">正在保存起草模型设置…</p>
          </div>
        ) : null}
        {health?.draftWithModelEnabled && health?.draftWithModelActive === false ? (
          <div className="lm-callout lm-callout-warn" role="status">
            <p className="lm-callout-body">
              已开启起草大模型，但当前模型凭据不可用；工作流将回退到规则模板起草。
            </p>
          </div>
        ) : null}
        <details className="lm-settings-advanced">
          <summary>高级：检索策略、平台模型与调试</summary>
          <div className="lm-settings-advanced-body">
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
        {platformMode !== "none" ? (
          <div className="lm-callout lm-callout-info" role="status">
            <p className="lm-callout-body">
              平台模型已启用（{platformMode === "proxy" ? "SaaS 代理" : "运维注入 Key"}）。
              对话中可选「平台模型」分组；界面不会显示平台 API Key。
            </p>
          </div>
        ) : null}
        {platformProviders.length > 0 ? (
          <div className="lm-provider-key-grid">
            {platformProviders.map((p) => (
              <div className="lm-settings-row" key={`platform-${p.provider}`}>
                <span className="lm-settings-key">平台 · {p.label}</span>
                <span className={p.configured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
                  {p.configured ? "已开通" : "未开通"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {modelProviders.length > 0 ? (
          <div className="lm-provider-key-grid">
            {modelProviders.map((p) => (
              <div className="lm-settings-row" key={p.provider}>
                <span className="lm-settings-key">我的 · {p.label}</span>
                <span className={p.configured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
                  {p.configured ? "已配置" : "未配置"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
            API 配置向导（通义 / 默认 Key）
          </button>
          {apiBase ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={modelTestBusy || !health?.modelConfigured}
              onClick={() => void onTestModel()}
            >
              {modelTestBusy ? "测试中…" : "测试模型连接"}
            </button>
          ) : null}
        </div>
        {modelTestResult ? (
          <div
            className={`lm-callout ${modelTestResult.startsWith("连接成功") ? "lm-callout-success" : "lm-callout-danger"}`}
            role="status"
          >
            <p className="lm-callout-body">{modelTestResult}</p>
          </div>
        ) : null}
        {apiBase && onModelsChanged ? (
          <LawmindSettingsCustomModels
            apiBase={apiBase}
            customModels={customModels}
            onChanged={onModelsChanged}
          />
        ) : null}
        <label className="lm-radio-row lm-settings-diagnostics-toggle">
          <input type="checkbox" checked={turnDiagnostics} onChange={onTurnDiagnosticsChange} />
          <span>对话调试信息（路由与工具调用摘要）</span>
        </label>
          </div>
        </details>
      </div>
    </div>
  );
}
