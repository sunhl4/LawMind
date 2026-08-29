import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { apiPatch } from "./lawmind-api-routes.ts";
import { LawmindSettingsMcp } from "./LawmindSettingsMcp";

type ToolRow = {
  name: string;
  description: string;
  category: string;
  requiresApproval: boolean;
  governance?: {
    runtimeMode?: string;
    matterScope?: string;
    riskLevel?: string;
    policyReason?: string;
  };
};

type Props = {
  apiBase: string;
};

export function LawmindSettingsTools(props: Props): ReactNode {
  const { apiBase } = props;
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highSecurityMode, setHighSecurityMode] = useState(false);
  const [allowAnalysisScripts, setAllowAnalysisScripts] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [allowlistHint, setAllowlistHint] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    void apiGetJson<{ ok?: boolean; tools?: ToolRow[] }>(apiBase, "/api/tools/registry")
      .then((r) => setTools(r.tools ?? []))
      .catch((e) => setError(errorMessage(e, "无法加载工具列表")));
    void apiGetJson<{ ok?: boolean; highSecurityMode?: boolean; allowAnalysisScripts?: boolean }>(
      apiBase,
      "/api/policy/workspace",
    )
      .then((r) => {
        setHighSecurityMode(r.highSecurityMode === true);
        setAllowAnalysisScripts(r.allowAnalysisScripts === true);
      })
      .catch(() => setHighSecurityMode(false));
  }, [apiBase]);

  async function toggleHighSecurity(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setPolicyBusy(true);
    try {
      const next = !highSecurityMode;
      const r = await apiPatch(apiBase, "/api/policy/workspace", { highSecurityMode: next });
      setHighSecurityMode(r.highSecurityMode === true);
      setAllowAnalysisScripts(r.allowAnalysisScripts === true);
    } catch (e) {
      setError(errorMessage(e, "更新高安全模式失败"));
    } finally {
      setPolicyBusy(false);
    }
  }

  async function applyRecommendedAllowlist(): Promise<void> {
    if (!apiBase) {
      return;
    }
    setPolicyBusy(true);
    setAllowlistHint(null);
    try {
      const r = await apiSendJson<
        {
          ok?: boolean;
          networkAllowlist?: string[];
          note?: string;
          error?: string;
        },
        Record<string, never>
      >(apiBase, "/api/policy/workspace/recommended-allowlist", "POST", {});
      if (!r.ok) {
        throw new Error(r.error ?? "写入失败");
      }
      setAllowlistHint(
        r.note ??
          `已写入 ${r.networkAllowlist?.length ?? 0} 个推荐主机（未强制开网）。`,
      );
    } catch (e) {
      setError(errorMessage(e, "写入推荐白名单失败"));
    } finally {
      setPolicyBusy(false);
    }
  }

  const approvalCount = tools?.filter((t) => t.requiresApproval).length ?? 0;

  return (
    <div className="lm-settings-section lm-settings-advanced-page">
      <p className="lm-settings-lead">联网与敏感操作。</p>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <div className="lm-settings-row-stack">
            <span className="lm-settings-key">高安全模式</span>
            <span className="lm-settings-caption" style={{ margin: 0 }}>
              关闭联网检索，并降低遥测上报
            </span>
          </div>
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${highSecurityMode ? "lm-btn-accent" : "lm-btn-secondary"}`}
            disabled={policyBusy}
            onClick={() => void toggleHighSecurity()}
          >
            {policyBusy ? "保存中…" : highSecurityMode ? "已开启" : "未开启"}
          </button>
        </div>
        <div className="lm-settings-row">
          <div className="lm-settings-row-stack">
            <span className="lm-settings-key">推荐法律检索白名单</span>
            <span className="lm-settings-caption" style={{ margin: 0 }}>
              一键写入 Brave + 常见法规站主机；不强制开启联网，也不强制 enforcement
            </span>
          </div>
          <button
            type="button"
            className="lm-btn lm-btn-sm lm-btn-secondary"
            data-testid="lm-settings-recommended-allowlist"
            disabled={policyBusy}
            onClick={() => void applyRecommendedAllowlist()}
          >
            写入推荐主机
          </button>
        </div>
        <div className="lm-settings-row">
          <div className="lm-settings-row-stack">
            <span className="lm-settings-key">分析脚本</span>
            <span className="lm-settings-caption" style={{ margin: 0 }}>
              允许运行你确认过的表格分析脚本（只读表、统计、落表、出图）。默认关闭；高安全模式下强制关闭。
            </span>
          </div>
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${allowAnalysisScripts ? "lm-btn-accent" : "lm-btn-secondary"}`}
            data-testid="lm-settings-analysis-scripts"
            disabled={policyBusy || highSecurityMode}
            onClick={() => {
              void (async () => {
                setPolicyBusy(true);
                try {
                  const next = !allowAnalysisScripts;
                  const r = await apiPatch(apiBase, "/api/policy/workspace", {
                    allowAnalysisScripts: next,
                  });
                  setAllowAnalysisScripts(r.allowAnalysisScripts === true);
                } catch (e) {
                  setError(errorMessage(e, "更新分析脚本政策失败"));
                } finally {
                  setPolicyBusy(false);
                }
              })();
            }}
          >
            {policyBusy ? "保存中…" : allowAnalysisScripts ? "已开启" : "未开启"}
          </button>
        </div>
        {allowlistHint ? (
          <p className="lm-settings-caption" role="status">
            {allowlistHint}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
          {error}
        </p>
      ) : null}

      <details className="lm-settings-advanced">
        <summary>
          <span className="lm-settings-advanced__label">助手可用工具</span>
          {tools && tools.length > 0 ? (
            <span className="lm-settings-advanced__hint">
              {tools.length} 项 · {approvalCount} 项需批准
            </span>
          ) : (
            <span className="lm-settings-advanced__hint">只读一览</span>
          )}
        </summary>
        <div className="lm-settings-advanced-body">
          {tools === null ? <p className="lm-settings-caption">加载中…</p> : null}
          {tools && tools.length === 0 ? (
            <p className="lm-settings-caption">暂无工具登记。</p>
          ) : null}
          {tools && tools.length > 0 ? (
            <ul className="lm-tools-registry-list">
              {tools.map((t) => (
                <li key={t.name} className="lm-tools-registry-row">
                  <div className="lm-tools-registry-main">
                    <strong>{t.name}</strong>
                    {t.description ? <p className="lm-meta">{t.description}</p> : null}
                    <span className="lm-meta">
                      {t.category}
                      {t.governance?.riskLevel ? ` · 风险 ${t.governance.riskLevel}` : ""}
                      {t.governance?.matterScope === "required" ? " · 需绑定案件" : ""}
                    </span>
                  </div>
                  {t.requiresApproval ? (
                    <span className="lm-pill lm-pill-warn">需批准</span>
                  ) : (
                    <span className="lm-pill lm-pill-neutral">常规</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>

      <LawmindSettingsMcp apiBase={apiBase} />
    </div>
  );
}
