import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "./api-client";
import {
  readIncludeTurnDiagnostics,
  writeIncludeTurnDiagnostics,
} from "./lawmind-chat-diagnostics-pref.ts";
import { LawmindSettingsCustomModels } from "./LawmindSettingsCustomModels";
import {
  fetchModelsCatalog,
  setRetrievalModelIdApi,
  setWorkerModelIdApi,
  testModelConnection,
  type ModelCatalogEntry,
  type PlatformProviderKeyStatus,
  type ProviderKeyStatus,
} from "./lawmind-models-api";
import {
  formatAuthorityProbeSuccessMsg,
  isAuthorityCorpusUiReady,
  webSearchStatusLabel,
  type LawmindSettingsAppConfig,
  type LawmindSettingsHealth,
} from "./lawmind-settings-models.ts";
import { isActiveModelVerified } from "./lawmind-model-verify";
import { LawmindAuthoritySetup } from "./LawmindAuthoritySetup";

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
  const [workerModelId, setWorkerModelId] = useState<string>("");
  const [retrievalModelId, setRetrievalModelId] = useState<string>("");
  const [workerSaving, setWorkerSaving] = useState(false);
  const [retrievalModelSaving, setRetrievalModelSaving] = useState(false);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    void fetchModelsCatalog(apiBase)
      .then((c) => {
        setWorkerModelId(c.workerModelId?.trim() || "");
        setRetrievalModelId(c.retrievalModelId?.trim() || "");
      })
      .catch(() => {
        setWorkerModelId("");
        setRetrievalModelId("");
      });
  }, [apiBase]);
  const [turnDiagnostics, setTurnDiagnostics] = useState(readIncludeTurnDiagnostics);
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<string | null>(null);
  const [authorityProbeBusy, setAuthorityProbeBusy] = useState(false);
  const [authorityProbeMsg, setAuthorityProbeMsg] = useState<string | null>(null);
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

  const onProbeAuthority = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    setAuthorityProbeBusy(true);
    setAuthorityProbeMsg(null);
    try {
      const j = (await apiSendJson(apiBase, "/api/authority/probe", "POST", {})) as {
        ok?: boolean;
        probe?: { ok?: boolean; latencyMs?: number; hitCount?: number; error?: string };
        note?: string;
        message?: string;
        error?: string;
      };
      if (j.ok && j.probe?.ok) {
        setAuthorityProbeMsg(
          formatAuthorityProbeSuccessMsg({
            latencyMs: j.probe.latencyMs,
            hitCount: j.probe.hitCount,
            note: j.note,
            provider: health?.authorityCorpus?.provider,
          }),
        );
      } else {
        setAuthorityProbeMsg(
          [j.note, j.probe?.error || j.message || j.error || "权威端点探测失败（fail-closed）。"]
            .filter(Boolean)
            .join(" · "),
        );
      }
    } catch (cause) {
      setAuthorityProbeMsg(errorMessage(cause, "权威端点探测失败"));
    } finally {
      setAuthorityProbeBusy(false);
    }
  }, [apiBase, health?.authorityCorpus?.provider]);

  const modelOk =
    Boolean(health?.modelConfigured) &&
    isActiveModelVerified({
      catalog: modelCatalog,
      selectedModelId,
      healthVerified: health?.modelVerified,
    });
  const webStatus = webSearchStatusLabel(health ?? {});
  const shareRetrieval = config.retrievalMode !== "dual";
  const configuredModels = modelCatalog.filter((m) => m.configured);

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型</span>
          <span className={modelOk ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
            {!health?.modelConfigured ? "待配置" : modelOk ? "已验证" : "待验证"}
          </span>
          {!health?.modelConfigured ? (
            <button type="button" className="lm-btn lm-btn-accent lm-btn-sm" onClick={onOpenApiWizard}>
              API 配置向导
            </button>
          ) : !modelOk && apiBase ? (
            <button
              type="button"
              className="lm-btn lm-btn-accent lm-btn-sm"
              data-testid="lm-settings-verify-model"
              disabled={modelTestBusy}
              onClick={() => void onTestModel()}
            >
              {modelTestBusy ? "验证中…" : "验证模型"}
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
            className={webStatus.ready ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"}
          >
            {webStatus.label}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">检索与对话共用同一模型</span>
          <label className="lm-switch">
            <input
              type="checkbox"
              role="switch"
              data-testid="lm-settings-share-retrieval"
              aria-checked={shareRetrieval}
              aria-label="检索与对话共用同一模型"
              checked={shareRetrieval}
              disabled={retrievalSaving || !health?.modelConfigured}
              onChange={(e) => applyRetrievalMode(e.target.checked ? "single" : "dual")}
            />
            <span className="lm-switch-ui" aria-hidden="true" />
          </label>
        </div>
        <p className="lm-settings-caption">
          {shareRetrieval
            ? "开启：不接法律垂类时，对话、法律检索、公开网页都走当前模型。"
            : "关闭：推理仍用当前模型；法律检索走下方垂类。公开网页优先垂类的厂商联网，没有则回退当前模型。"}
        </p>
        {shareRetrieval ? null : (
          <>
            <label className="lm-settings-row">
              <span className="lm-settings-key">法律检索模型</span>
              <select
                className="lm-compose-select"
                data-testid="lm-settings-retrieval-model"
                disabled={!apiBase || !health?.modelConfigured || retrievalModelSaving}
                value={retrievalModelId}
                aria-label="法律检索模型"
                onChange={(e) => {
                  const next = e.target.value;
                  setRetrievalModelId(next);
                  if (!apiBase) {
                    return;
                  }
                  setRetrievalModelSaving(true);
                  void setRetrievalModelIdApi(apiBase, next || null)
                    .then(async (id) => {
                      setRetrievalModelId(id ?? "");
                      if (onModelsChanged) {
                        await onModelsChanged();
                      }
                    })
                    .catch(() => undefined)
                    .finally(() => setRetrievalModelSaving(false));
                }}
              >
                <option value="">未选择（暂回退当前模型）</option>
                {configuredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {health?.dualLegalConfigured === false && !retrievalModelId ? (
              <p className="lm-settings-caption lm-settings-caption--warn" role="status">
                尚未选垂类模型，法律检索将暂时回退当前对话模型。
              </p>
            ) : null}
          </>
        )}
        {retrievalSaving ? (
          <p className="lm-settings-caption" role="status" aria-live="polite">
            正在切换…
          </p>
        ) : null}
        <div
          data-testid="lm-settings-authority-boundary"
          data-status={health?.authorityCorpus?.status ?? "unset"}
        >
          <LawmindAuthoritySetup
            authorityCorpus={health?.authorityCorpus}
            authorityUsage={health?.authorityUsage}
            envFilePath={envFilePath}
            probeControl={
              apiBase ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  data-testid="lm-settings-authority-probe"
                  disabled={
                    authorityProbeBusy ||
                    !isAuthorityCorpusUiReady(health?.authorityCorpus?.status)
                  }
                  onClick={() => void onProbeAuthority()}
                  title={
                    isAuthorityCorpusUiReady(health?.authorityCorpus?.status)
                      ? health?.authorityCorpus?.provider === "open"
                        ? "探测开源本地语料是否就绪（非厂商付费库核验）"
                        : "对已配置端点发起契约健康探测（非厂商语料核验）"
                      : "开源：检查语料；闭源/generic：需先配置合法 LAWMIND_AUTHORITY_ENDPOINT"
                  }
                >
                  {authorityProbeBusy
                    ? "探测中…"
                    : health?.authorityCorpus?.provider === "open"
                      ? "探测开源语料"
                      : "探测权威端点"}
                </button>
              ) : null
            }
          />
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
        ) : !modelOk ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="status">
            已填 Key 还不等于能连上。请点「验证模型」；失败时到服务商重新生成 Key，再用向导粘贴。
          </p>
        ) : health?.modelEnvFileExists === false ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="status">
            请重新保存。
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
              {modelTestBusy ? "验证中…" : "验证模型"}
            </button>
          ) : null}
        </div>
        {authorityProbeMsg ? (
          <p
            className="lm-settings-caption"
            role="status"
            data-testid="lm-settings-authority-probe-msg"
          >
            {authorityProbeMsg}
          </p>
        ) : null}
      </div>

      <details className="lm-settings-advanced">
        <summary>高级：起草、Worker、联网密钥、检索与自定义模型</summary>
        <div className="lm-settings-advanced-body">
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

          <label className="lm-settings-row">
            <span className="lm-settings-key">Worker 模型（工具轮）</span>
            <select
              className="lm-compose-select"
              data-testid="lm-settings-worker-model"
              disabled={!apiBase || !health?.modelConfigured || workerSaving}
              value={workerModelId}
              aria-label="工具轮 Worker 模型"
              onChange={(e) => {
                const next = e.target.value;
                setWorkerModelId(next);
                if (!apiBase) {
                  return;
                }
                setWorkerSaving(true);
                void setWorkerModelIdApi(apiBase, next || null)
                  .then((id) => setWorkerModelId(id ?? ""))
                  .catch(() => undefined)
                  .finally(() => setWorkerSaving(false));
              }}
            >
              <option value="">同主模型</option>
              {modelCatalog
                .filter((m) => m.configured)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </select>
          </label>
          <p className="lm-settings-caption">工具轮可用更快模型。</p>

          <p className="lm-settings-caption">
            公开网页检索默认跟对话模型走同一套 Key。仅当上方关掉「共用」且法律检索模型自带厂商联网时，才会改用垂类去搜网页。Brave
            仍是没有厂商联网时的可选备用（
            <code className="lm-md-code">LAWMIND_WEB_SEARCH_API_KEY</code> /{" "}
            <code className="lm-md-code">BRAVE_API_KEY</code>
            ）。
          </p>
          <p className="lm-settings-caption">
            当前策略：{retrievalLabel}。
          </p>

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
                  <span className={p.configured ? "lm-pill lm-pill-neutral" : "lm-pill lm-pill-warn"}>
                    {p.configured ? "已填 Key" : "未填 Key"}
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
