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
      <div className="lm-settings-group">
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
        <div className="lm-settings-actions">
          <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onPickProject}>
            {projectDir ? "切换项目" : "打开项目目录"}
          </button>
          {projectDir && (
            <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" onClick={onClearProject}>
              关闭项目
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
