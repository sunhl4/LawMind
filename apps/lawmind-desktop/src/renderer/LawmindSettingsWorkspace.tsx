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
    <div className="lm-settings-section" id="lawmind-settings-workspace">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">本机文件夹</div>
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">侧栏「工作区」</span>
          {projectDir ? (
            <span className="lm-settings-val lm-project-path" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          ) : (
            <span className="lm-settings-val lm-project-none">未选择本机文件夹</span>
          )}
        </div>
        {projectDir && <div className="lm-project-full-path">{projectDir}</div>}
        {!projectDir ? (
          <div className="lm-callout lm-callout-info" role="note">
            <p className="lm-callout-body">
              选择电脑上的文件夹后，侧栏「工作区」会显示该路径下的文件，便于写文档与管材料；不会展示软件内部目录。可随时切换或关闭。
            </p>
          </div>
        ) : null}
        <div className="lm-settings-actions">
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${projectDir ? "lm-btn-secondary" : "lm-btn-accent"}`}
            onClick={onPickProject}
          >
            {projectDir ? "更换本机文件夹" : "选择本机文件夹"}
          </button>
          {projectDir && (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onClearProject}>
              关闭本机文件夹
            </button>
          )}
        </div>
        <div className="lm-settings-row" style={{ marginTop: 12 }}>
          <span className="lm-settings-key">软件数据目录</span>
          <span className="lm-settings-val" title={config.workspaceDir}>
            {workspaceLabel}
          </span>
        </div>
        <p className="lm-meta" style={{ marginTop: 4 }}>
          上一项仅供系统保存案件与配置，侧栏「工作区」不会打开这里。
        </p>
      </div>
    </div>
  );
}
