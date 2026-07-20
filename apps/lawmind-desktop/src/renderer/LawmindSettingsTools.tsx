import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { lawmindDocUrl } from "./lawmind-public-urls.js";
import { apiPatch } from "./lawmind-api-routes.ts";

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
  const [policyBusy, setPolicyBusy] = useState(false);
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    void apiGetJson<{ ok?: boolean; tools?: ToolRow[] }>(apiBase, "/api/tools/registry")
      .then((r) => setTools(r.tools ?? []))
      .catch((e) => setError(errorMessage(e, "无法加载工具列表")));
    void apiGetJson<{ ok?: boolean; highSecurityMode?: boolean }>(apiBase, "/api/policy/workspace")
      .then((r) => setHighSecurityMode(r.highSecurityMode === true))
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
    } catch (e) {
      setError(errorMessage(e, "更新高安全模式失败"));
    } finally {
      setPolicyBusy(false);
    }
  }

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">工具治理</div>
      <p className="lm-meta">
        个人律师日常只需要确认“是否启用高安全模式”。具体工具、MCP 和权限策略会在后台自动执行。
      </p>
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">高安全模式</span>
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${highSecurityMode ? "lm-btn-accent" : "lm-btn-secondary"}`}
            disabled={policyBusy}
            onClick={() => void toggleHighSecurity()}
          >
            {policyBusy ? "保存中…" : highSecurityMode ? "已开启" : "未开启"}
          </button>
        </div>
        <p className="lm-meta">
          开启后写入 lawmind.policy.json：关闭联网检索并降低遥测采集（本地工作区仍可用）。
        </p>
      </div>
      {error ? <p className="lm-meta lm-callout-warn">{error}</p> : null}
      <details
        className="lm-settings-group lm-settings-surface"
        open={showAdvancedTools}
        onToggle={(event) => setShowAdvancedTools(event.currentTarget.open)}
      >
        <summary>高级：查看工具与权限细节</summary>
        <p className="lm-meta">
          这些信息主要用于排错和部署审查。普通写文稿、做案件时无需理解每个工具。
        </p>
        {tools === null ? <p className="lm-meta">加载中…</p> : null}
        {tools && tools.length > 0 ? (
        <ul className="lm-tools-registry-list">
          {tools.map((t) => (
            <li key={t.name} className="lm-tools-registry-row">
              <strong>{t.name}</strong>
              <span className="lm-meta">
                {t.category}
                {t.governance?.riskLevel ? ` · 风险 ${t.governance.riskLevel}` : ""}
                {t.governance?.matterScope === "required" ? " · 需案件" : ""}
              </span>
              {t.requiresApproval ? (
                <span className="lm-pill lm-pill-warn">需批准</span>
              ) : (
                <span className="lm-pill lm-pill-neutral">常规</span>
              )}
              <p className="lm-meta">{t.description}</p>
              {t.governance?.policyReason ? (
                <p className="lm-meta">{t.governance.policyReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
        ) : null}
      </details>
      <details className="lm-settings-group lm-settings-surface">
        <summary>外部助手（MCP）</summary>
        <p className="lm-meta">
          可通过只读 MCP 将工作区诊断、案件与草稿查询暴露给 Cursor / Claude Desktop 等外部助手，默认不写入工作区。
          启动命令：<code>pnpm lawmind:mcp:readonly</code>（stdio）。
        </p>
        <p className="lm-meta">
          Headless npm SDK 尚未公开发布；集成边界与路线图见{" "}
          <a href={lawmindDocUrl("LAWMIND-INTEGRATIONS")} target="_blank" rel="noreferrer noopener">
            LAWMIND-INTEGRATIONS
          </a>
          。可复制粘贴的 MCP 配置片段在「系统体检」页。
        </p>
      </details>
    </div>
  );
}
