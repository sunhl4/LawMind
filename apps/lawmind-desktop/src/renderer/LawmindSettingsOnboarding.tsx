import type { ReactNode } from "react";

type HealthShape = {
  modelConfigured: boolean;
  retrievalMode?: string;
  dualLegalConfigured?: boolean;
  webSearchApiKeyConfigured?: boolean;
} | null;

type Props = {
  health: HealthShape;
  projectDir: string | null;
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
  const { health, projectDir } = props;
  return (
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
          <span className="lm-settings-key">办案材料文件夹</span>
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
        <div className="lm-callout lm-callout-muted lm-onboarding-hint" role="note">
          <p className="lm-callout-body">
            可用「API 配置向导」填密钥；上表由软件自动检查，一般不必逐条研究。
          </p>
        </div>
      </div>
    </div>
  );
}
