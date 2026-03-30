import type { ReactNode } from "react";

export type CollabSummaryState =
  | undefined
  | null
  | {
      collaborationEnabled: boolean;
      collaborationHint?: string;
      delegationCount: number;
    };

type Props = {
  collabSummarySettings: CollabSummaryState;
};

/**
 * Settings panel block: collaboration toggle summary from GET /api/collaboration/summary.
 */
export function LawmindSettingsCollaboration(props: Props): ReactNode {
  const { collabSummarySettings } = props;
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">协作</div>
      <div className="lm-settings-group">
        {collabSummarySettings === undefined ? (
          <div className="lm-meta">加载协作状态…</div>
        ) : collabSummarySettings === null ? (
          <div className="lm-meta">无法加载协作摘要，请检查本地服务是否运行。</div>
        ) : (
          <>
            <div className="lm-settings-row">
              <span className="lm-settings-key">协作开关</span>
              <span
                className={
                  collabSummarySettings.collaborationEnabled ? "lm-dot lm-dot-ok" : "lm-dot lm-dot-warn"
                }
              >
                {collabSummarySettings.collaborationEnabled ? "已开启" : "已关闭"}
              </span>
            </div>
            <div className="lm-settings-row">
              <span className="lm-settings-key">当前委派数</span>
              <span className="lm-settings-val">{collabSummarySettings.delegationCount}</span>
            </div>
            {collabSummarySettings.collaborationHint ? (
              <div className="lm-meta">{collabSummarySettings.collaborationHint}</div>
            ) : null}
            <div className="lm-meta">
              集成与外部系统边界见{" "}
              <a href="https://docs.openclaw.ai/LAWMIND-INTEGRATIONS" target="_blank" rel="noreferrer noopener">
                官方说明
              </a>
              。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
