import type { ReactNode } from "react";
import type { LawmindSettingsAppConfig } from "./lawmind-settings-models.ts";

type Props = {
  config: LawmindSettingsAppConfig;
  workspaceLabel: string;
  projectDir: string | null;
  onPickProject: () => void;
  onClearProject: () => void;
};

export function LawmindSettingsWorkspace(props: Props): ReactNode {
  const { config, workspaceLabel, projectDir, onPickProject, onClearProject } = props;
  return (
    <div className="lm-settings-section">
      <div className="lm-settings-section-title">工作区与项目</div>
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">工作区</span>
          <span className="lm-settings-val" title={config.workspaceDir}>
            {workspaceLabel}
          </span>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">项目目录</span>
          {projectDir ? (
            <span className="lm-settings-val lm-project-path" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          ) : (
            <span className="lm-settings-val lm-project-none">未选择</span>
          )}
        </div>
        {projectDir && <div className="lm-project-full-path">{projectDir}</div>}
        {!projectDir ? (
          <div className="lm-callout lm-callout-info" role="note">
            <p className="lm-callout-body">
              选择办案材料根目录后，记忆来源与文件工作台会按项目组织；可随时切换或关闭项目。
            </p>
          </div>
        ) : null}
        <div className="lm-settings-actions">
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${projectDir ? "lm-btn-secondary" : "lm-btn-accent"}`}
            onClick={onPickProject}
          >
            {projectDir ? "切换项目" : "打开项目目录"}
          </button>
          {projectDir && (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onClearProject}>
              关闭项目
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
