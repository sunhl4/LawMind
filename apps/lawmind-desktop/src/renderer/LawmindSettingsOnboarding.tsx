import type { ReactNode } from "react";

type HealthShape = {
  modelConfigured: boolean;
} | null;

type Props = {
  health: HealthShape;
  projectDir: string | null;
};

/**
 * Settings panel block: first-run checklist (API, local service, optional project dir).
 */
export function LawmindSettingsOnboarding(props: Props): ReactNode {
  const { health, projectDir } = props;
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">入门进度</div>
      <div className="lm-settings-group lm-onboarding-checklist">
        <div className="lm-settings-row">
          <span className="lm-settings-key">模型 API</span>
          <span className={health?.modelConfigured ? "lm-dot lm-dot-ok" : "lm-dot lm-dot-warn"}>
            {health?.modelConfigured ? "已配置" : "待配置"}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">本地服务</span>
          <span className={health !== null ? "lm-dot lm-dot-ok" : "lm-dot lm-dot-warn"}>
            {health !== null ? "已连接" : "检测中…"}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">项目目录（可选）</span>
          <span className={projectDir ? "lm-dot lm-dot-ok" : "lm-meta"}>{projectDir ? "已选择" : "未选择"}</span>
        </div>
        <div className="lm-meta lm-onboarding-hint">
          打开「API 配置向导」可完成密钥配置；健康状态来自{" "}
          <code className="lm-md-code">GET /api/health</code>。
        </div>
      </div>
    </div>
  );
}
