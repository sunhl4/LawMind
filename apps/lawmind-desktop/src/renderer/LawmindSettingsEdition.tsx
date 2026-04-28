/**
 * Edition & DeliverableSpec inspector — surfaces the resolved LawMind product edition,
 * which feature flags it unlocks, and which DeliverableSpecs are loaded
 * (built-in vs. workspace extras). Read-only; helpful for IT admins / firms
 * verifying that their workspace policy + custom specs landed correctly.
 */

import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";
import { useEdition } from "./use-edition";

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
  { key: "customDeliverableSpec", label: "本所自己加文书类型" },
  { key: "acceptancePackExport", label: "一键打包验收材料" },
  { key: "qualityDashboardJsonExport", label: "质量数据导出（JSON，给系统用）" },
  { key: "complianceAuditExport", label: "合规审计批量导出" },
  { key: "crossMatterRoadmap", label: "跨案件路线图" },
  { key: "crossMatterAcceptanceDashboard", label: "跨案件验收就绪概览" },
  { key: "collaborationSummary", label: "协作摘要" },
  { key: "strictDangerousToolApproval", label: "危险工具须显式批准（律所版）" },
  { key: "securitySbomPanel", label: "安全组件清单（技术）" },
];

type Props = {
  apiBase: string;
};

export function LawmindSettingsEdition({ apiBase }: Props): ReactNode {
  const edition = useEdition(apiBase);
  const [specs, setSpecs] = useState<DeliverableSpecSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const workspaceSpecs = specs?.filter((s) => s.source === "workspace") ?? [];
  const builtinSpecs = specs?.filter((s) => s.source === "builtin") ?? [];

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
                <span>{row.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

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
