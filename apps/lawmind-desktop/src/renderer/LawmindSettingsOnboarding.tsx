import type { ReactNode } from "react";
import type { LawmindSettingsSectionId } from "./lawmind-settings-nav";

type HealthShape = {
  modelConfigured: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
} | null;

type QuickLink = {
  sectionId: LawmindSettingsSectionId;
  label: string;
  hint: string;
};

const QUICK_LINKS: QuickLink[] = [
  { sectionId: "models", label: "模型/API", hint: "密钥与检索" },
  { sectionId: "workspace", label: "工作区", hint: "数据与材料夹" },
  { sectionId: "memory", label: "记忆库", hint: "待采纳建议" },
  { sectionId: "collaboration", label: "团队工作流", hint: "委派摘要" },
];

type Props = {
  health: HealthShape;
  projectDir: string | null;
  onOpenApiWizard?: () => void;
  onNavigateToSection?: (sectionId: LawmindSettingsSectionId) => void;
};

function retrievalModeLabel(mode: string | undefined): string {
  const m = (mode ?? "").toLowerCase();
  if (m === "dual") {
    return "双库（更全，需配齐）";
  }
  if (m === "single") {
    return "单库（常用）";
  }
  return mode?.trim() ? mode : "未知";
}

/**
 * Settings panel block: first-run checklist (API, local service, optional project dir).
 */
export function LawmindSettingsOnboarding(props: Props): ReactNode {
  const { health, projectDir, onOpenApiWizard, onNavigateToSection } = props;
  return (
    <>
      {onNavigateToSection ? (
        <div className="lm-settings-section">
          <div className="lm-settings-section-title">快捷入口</div>
          <div className="lm-settings-quick-links">
            {QUICK_LINKS.map((link) => (
              <button
                key={link.sectionId}
                type="button"
                className="lm-settings-quick-link"
                onClick={() => onNavigateToSection(link.sectionId)}
              >
                <span className="lm-settings-quick-link-label">{link.label}</span>
                <span className="lm-settings-quick-link-hint">{link.hint}</span>
              </button>
            ))}
            {!health?.modelConfigured && onOpenApiWizard ? (
              <button
                type="button"
                className="lm-settings-quick-link lm-settings-quick-link--accent"
                onClick={() => onOpenApiWizard()}
              >
                <span className="lm-settings-quick-link-label">配置 API</span>
                <span className="lm-settings-quick-link-hint">打开密钥向导</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="lm-settings-section">
        <div className="lm-settings-section-title">就绪情况</div>
        <div className="lm-settings-group lm-settings-surface lm-onboarding-checklist">
          <div className="lm-settings-row">
            <span className="lm-settings-key">AI 服务</span>
            <span className={health?.modelConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-warn"}>
              {health?.modelConfigured ? "已配置" : "待配置"}
            </span>
          </div>
          <div className="lm-settings-row">
            <span className="lm-settings-key">本机 LawMind</span>
            <span className={health !== null ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"}>
              {health !== null ? "已连接" : "检测中…"}
            </span>
          </div>
          <div className="lm-settings-row">
            <span className="lm-settings-key">本机文件夹</span>
            <span className={projectDir ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"}>
              {projectDir ? "已选择" : "未选择"}
            </span>
          </div>
          <div className="lm-settings-row">
            <span className="lm-settings-key">法规检索</span>
            <span
              className={
                health?.retrievalMode ? "lm-pill lm-pill-neutral" : "lm-pill lm-pill-warn"
              }
            >
              {health ? retrievalModeLabel(health.retrievalMode) : "检测中…"}
            </span>
          </div>
          <div className="lm-settings-row">
            <span className="lm-settings-key">法规双库</span>
            <span
              className={
                !health
                  ? "lm-pill lm-pill-neutral"
                  : health.dualLegalConfigured
                    ? "lm-pill lm-pill-success"
                    : "lm-pill lm-pill-warn"
              }
            >
              {health ? (health.dualLegalConfigured ? "已就绪" : "未配齐") : "检测中…"}
            </span>
          </div>
          <div className="lm-settings-row">
            <span className="lm-settings-key">上网查法规</span>
            <span
              className={
                health?.webSearchApiKeyConfigured ? "lm-pill lm-pill-success" : "lm-pill lm-pill-neutral"
              }
            >
              {health ? (health.webSearchApiKeyConfigured ? "已配置" : "未配置") : "检测中…"}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
