/**
 * Edition & DeliverableSpec inspector — surfaces the resolved LawMind product edition,
 * which feature flags it unlocks, and which DeliverableSpecs are loaded
 * (built-in vs. workspace extras). Read-only; helpful for IT admins / firms
 * verifying that their workspace policy + custom specs landed correctly.
 */

import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "./api-client";
import { useEdition } from "./use-edition";
import { apiAuthHeaders } from "./lawmind-api-auth";

type DeliverableSpecSummary = {
  type: string;
  displayName: string;
  description: string;
  defaultOutput: string;
  defaultRiskLevel: string;
  blockerSectionCount: number;
  acceptanceCriteriaCount: number;
  source: "builtin" | "workspace";
};

type FeatureRow = {
  key: keyof ReturnType<typeof useEdition>["features"];
  label: string;
};

const FEATURE_ROWS: FeatureRow[] = [
  { key: "acceptanceGateStrict", label: "出稿前检查更严（缺项先拦）" },
  { key: "citationGateStrict", label: "引用完整性硬门禁（导出 Word 时拦缺源/未锚定；不拦签批）" },
  { key: "customDeliverableSpec", label: "本所自己加文书类型" },
  { key: "acceptancePackExport", label: "一键打包验收材料" },
  { key: "qualityDashboardJsonExport", label: "质量数据导出（JSON，给系统用）" },
  { key: "complianceAuditExport", label: "合规审计批量导出" },
  { key: "auditIntegrityExport", label: "审计 hash-chain 完整性导出" },
  { key: "crossMatterRoadmap", label: "跨案件路线图" },
  { key: "crossMatterAcceptanceDashboard", label: "跨案件验收就绪概览" },
  { key: "collaborationSummary", label: "协作摘要" },
  { key: "strictDangerousToolApproval", label: "危险工具须显式批准（律所版）" },
  { key: "reviewCampaignParallel", label: "审查专案组并行执行（律所版）" },
  { key: "securitySbomPanel", label: "安全组件清单（技术）" },
];

type Props = {
  apiBase: string;
};

export function LawmindSettingsEdition({ apiBase }: Props): ReactNode {
  const edition = useEdition(apiBase);
  const [specs, setSpecs] = useState<DeliverableSpecSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportHint, setExportHint] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const j = await apiGetJson<{ ok?: boolean; specs?: DeliverableSpecSummary[] }>(
          apiBase,
          "/api/deliverables/specs",
        );
        if (cancelled) {
          return;
        }
        if (j.ok && Array.isArray(j.specs)) {
          setSpecs(j.specs);
        } else {
          setError("无法加载文书清单");
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "加载失败");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const downloadAuditMarkdown = async (compliance: boolean) => {
    if (!apiBase?.trim()) {
      return;
    }
    setExportBusy(true);
    setExportHint(null);
    try {
      const q = compliance ? "?compliance=true" : "";
      const res = await fetch(`${apiBase}/api/audit/export${q}`, { headers: apiAuthHeaders() });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
        throw new Error(body?.message ?? body?.error ?? `导出失败（HTTP ${res.status}）`);
      }
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = compliance ? "lawmind-compliance-audit.md" : "lawmind-audit-export.md";
      a.click();
      URL.revokeObjectURL(url);
      setExportHint(compliance ? "已下载合规审计 Markdown。" : "已下载审计 Markdown。");
    } catch (e) {
      setExportHint(errorMessage(e, "审计导出失败"));
    } finally {
      setExportBusy(false);
    }
  };

  const fetchIntegritySummary = async () => {
    if (!apiBase?.trim()) {
      return;
    }
    setExportBusy(true);
    setExportHint(null);
    try {
      const j = await apiGetJson<{
        ok?: boolean;
        integrity?: { ok?: boolean; eventCount?: number; chainedCount?: number; brokenAt?: number };
      }>(apiBase, "/api/audit/export?integrity=true");
      const i = j.integrity;
      if (!i) {
        setExportHint("无完整性摘要。");
      } else {
        const chainNote =
          typeof i.brokenAt === "number"
            ? `断链位于索引 ${i.brokenAt}`
            : i.ok === false
              ? "存在异常"
              : "完整";
        setExportHint(
          `hash-chain：事件 ${i.eventCount ?? 0} 条 · 已链式 ${i.chainedCount ?? 0} · ${chainNote}`,
        );
      }
    } catch (e) {
      setExportHint(errorMessage(e, "完整性校验失败（可能当前版本未开放）"));
    } finally {
      setExportBusy(false);
    }
  };

  const workspaceSpecs = specs?.filter((s) => s.source === "workspace") ?? [];
  const builtinSpecs = specs?.filter((s) => s.source === "builtin") ?? [];
  const canExportAudit =
    edition.features.complianceAuditExport || edition.features.auditIntegrityExport;
  const showEthicsSection =
    !edition.loading && (edition.edition === "firm" || edition.edition === "private_deploy");

  const downloadDisclosureTemplate = () => {
    const markdown = `# 客户人工智能辅助服务披露说明（模板）

> 本模板仅供律所内部治理与客户沟通参考，不构成法律意见。使用前请由合规负责人审阅并按本所政策调整。

## 1. 服务说明

本所为提升法律服务效率，可能在部分工作中使用人工智能（AI）辅助工具（下称「AI 辅助」），包括但不限于法律检索摘要、文书初稿整理、合同条款比对提示等。

## 2. 律师主导与专业判断

- 所有对外交付的法律意见、文书与策略建议，均由持证律师审阅并承担责任。
- AI 辅助输出仅供参考，不替代律师的专业判断；本所不对 AI 生成内容的准确性或完整性作单独保证。

## 3. 保密与数据隔离

- 案件材料按本所保密政策与工作区隔离策略处理；敏感案件可配置更高隔离等级。
- 新客户/新事项接洽阶段已纳入利益冲突检查流程；未完成冲突核查前，相关事项材料不会进入常规协作范围。

## 4. 客户知情权

如本所政策要求，律师将在适当阶段向客户说明是否使用 AI 辅助及大致用途。客户可就数据处理方式提出合理询问。

## 5. 免责声明

AI 辅助不能预测诉讼/仲裁/谈判结果。本所服务仍受委托合同、执业规范与适用法律的约束。

---
*LawMind 披露模板 · 生成于 ${new Date().toISOString().slice(0, 10)}*
`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lawmind-ai-disclosure-template.md";
    a.click();
    URL.revokeObjectURL(url);
    setExportHint("已下载披露说明模板（Markdown）。");
  };

  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">版本与文书类型</div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">当前版本</span>
          <span className="lm-settings-val">
            {edition.loading ? (
              <span className="lm-pill lm-pill-neutral">加载中…</span>
            ) : (
              <>
                {edition.label}
                <span className={`lm-edition-badge lm-edition-${edition.edition}`}>{edition.edition}</span>
              </>
            )}
          </span>
        </div>
        {!edition.loading && (
          <div className="lm-settings-row">
            <span className="lm-settings-key">来源</span>
            <span className="lm-settings-val lm-meta">{editionSourceLabel(edition.source)}</span>
          </div>
        )}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-subtitle">本版带哪些能力</div>
        <ul className="lm-edition-feature-list">
          {FEATURE_ROWS.map((row) => {
            const enabled = edition.features[row.key];
            return (
              <li key={row.key} className={`lm-edition-feature ${enabled ? "on" : "off"}`}>
                <span className="lm-edition-feature-mark" aria-hidden="true">
                  {enabled ? "✓" : "·"}
                </span>
                <span>
                  {row.label}
                  {!enabled ? (
                    <span className="lm-meta lm-edition-feature-locked">（律所版能力）</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {canExportAudit ? (
        <div className="lm-settings-group lm-settings-surface">
          <div className="lm-settings-subtitle">审计导出</div>
          <p className="lm-meta">
            从本地审计日志导出 Markdown，或校验 hash-chain 完整性。导出内容仅留在本机。
          </p>
          <div className="lm-settings-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={exportBusy}
              onClick={() => void downloadAuditMarkdown(false)}
            >
              导出审计 Markdown
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={exportBusy || !edition.features.complianceAuditExport}
              title={
                !edition.features.complianceAuditExport
                  ? "合规审计导出仅私有部署版开放"
                  : undefined
              }
              onClick={() => void downloadAuditMarkdown(true)}
            >
              导出合规审计 Markdown
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              disabled={exportBusy || !edition.features.auditIntegrityExport}
              onClick={() => void fetchIntegritySummary()}
            >
              校验 hash-chain
            </button>
          </div>
          {exportHint ? (
            <p className="lm-meta" role="status" style={{ marginTop: 8 }}>
              {exportHint}
            </p>
          ) : null}
          {!edition.features.complianceAuditExport && edition.features.auditIntegrityExport ? (
            <p className="lm-meta">当前版本仅开放完整性校验，未开放批量合规 Markdown 导出。</p>
          ) : null}
        </div>
      ) : (
        <div className="lm-settings-group lm-settings-surface">
          <div className="lm-settings-subtitle">审计导出</div>
          <p className="lm-meta">独立律师版不开放合规审计批量导出；律所版 / 私有部署可在此下载。</p>
        </div>
      )}

      {showEthicsSection ? (
        <div className="lm-settings-group lm-settings-surface">
          <div className="lm-settings-subtitle">伦理与披露</div>
          <p className="lm-meta">
            新建案件时已纳入利益冲突检查与接洽状态；案件可配置保密等级以实现敏感事项隔离。
            律所级多主体伦理墙与面向客户的正式 AI 披露流程属于治理制度，需由合规负责人在本所政策下执行。
          </p>
          <div className="lm-settings-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              onClick={() => downloadDisclosureTemplate()}
            >
              下载披露说明模板
            </button>
          </div>
          <p className="lm-meta" style={{ marginTop: 8 }}>
            模板为 Markdown 草案，说明 AI 辅助性质与不保证结果；请审阅后按本所格式转为 PDF 或客户函。
          </p>
        </div>
      ) : null}

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-subtitle">
          可用文书清单 {specs ? `（共 ${specs.length} 类）` : ""}
        </div>
        {error ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{error}</p>
          </div>
        ) : null}
        {!error && !specs ? (
          <div className="lm-settings-loading" aria-busy="true" aria-label="加载文书清单">
            <div className="lm-shimmer lm-shimmer-line" />
            <div className="lm-shimmer lm-shimmer-line lm-shimmer-short" />
          </div>
        ) : null}
        {specs && (
          <>
            {workspaceSpecs.length > 0 && (
              <div className="lm-edition-spec-block">
                <div className="lm-meta lm-edition-spec-block-head">
                  本工作区自定义（{workspaceSpecs.length}）
                </div>
                <ul className="lm-edition-spec-list">
                  {workspaceSpecs.map((s) => (
                    <SpecRow key={s.type} spec={s} />
                  ))}
                </ul>
              </div>
            )}
            <div className="lm-edition-spec-block">
              <div className="lm-meta lm-edition-spec-block-head">
                内置（{builtinSpecs.length}）
              </div>
              <ul className="lm-edition-spec-list">
                {builtinSpecs.map((s) => (
                  <SpecRow key={s.type} spec={s} />
                ))}
              </ul>
            </div>
            {!edition.features.customDeliverableSpec && (
              <div className="lm-callout lm-callout-muted" role="note">
                <p className="lm-callout-body">
                  当前版本未开放「本所自定义文书类型」。若单位有高级部署，可由管理员在材料区配置后生效。
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SpecRow({ spec }: { spec: DeliverableSpecSummary }) {
  return (
    <li className="lm-edition-spec-row">
      <div className="lm-edition-spec-head">
        <code className="lm-edition-spec-type">{spec.type}</code>
        <span className="lm-edition-spec-name">{spec.displayName}</span>
        <span className="lm-meta">{spec.defaultOutput}</span>
        <span className={`lm-badge lm-edition-spec-badge lm-edition-spec-${spec.source}`}>
          {spec.source === "workspace" ? "工作区" : "内置"}
        </span>
      </div>
      <div className="lm-meta lm-edition-spec-desc">{spec.description}</div>
      <div className="lm-meta">
        必备章节 {spec.blockerSectionCount} · 验收条目 {spec.acceptanceCriteriaCount} · 默认风险{" "}
        {spec.defaultRiskLevel}
      </div>
    </li>
  );
}

function editionSourceLabel(source: ReturnType<typeof useEdition>["source"]): string {
  switch (source) {
    case "policy_file":
      return "工作区 policy 文件";
    case "env":
      return "环境变量";
    case "default":
      return "默认（独立律师版）";
  }
}
