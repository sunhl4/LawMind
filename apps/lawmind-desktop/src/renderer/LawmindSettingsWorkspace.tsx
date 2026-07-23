import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import type { LawmindSettingsAppConfig } from "./lawmind-settings-models.ts";

type Props = {
  config: LawmindSettingsAppConfig;
  apiBase?: string;
  workspaceLabel: string;
  projectDir: string | null;
  onPickProject: () => void;
  onClearProject: () => void;
};

export function LawmindSettingsWorkspace(props: Props): ReactNode {
  const { config, apiBase, workspaceLabel, projectDir, onPickProject, onClearProject } = props;
  const [batchDir, setBatchDir] = useState("");
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskHint, setDeskHint] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase?.trim()) {
      return;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      settings?: { contractBatchRelativeDir?: string };
    }>(apiBase, "/api/workspace/desk-settings")
      .then((j) => {
        if (!cancelled && j.ok) {
          setBatchDir(j.settings?.contractBatchRelativeDir ?? "");
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function saveDeskSettings(): Promise<void> {
    if (!apiBase?.trim()) {
      return;
    }
    setDeskBusy(true);
    setDeskHint(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          settings?: { contractBatchRelativeDir?: string };
          message?: string;
          error?: string;
        },
        { contractBatchRelativeDir: string }
      >(apiBase, "/api/workspace/desk-settings", "POST", {
        contractBatchRelativeDir: batchDir.trim(),
      });
      if (!j.ok) {
        setDeskHint(j.message ?? j.error ?? "保存失败");
        return;
      }
      setBatchDir(j.settings?.contractBatchRelativeDir ?? batchDir.trim());
      setDeskHint("已保存");
    } catch (e) {
      setDeskHint(errorMessage(e, "保存失败"));
    } finally {
      setDeskBusy(false);
    }
  }

  return (
    <div className="lm-settings-section" id="lawmind-settings-workspace">
      <div className="lm-settings-section-title lm-settings-section-title--duplicate">本机文件夹</div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">侧栏材料夹</span>
          {projectDir ? (
            <span className="lm-settings-val lm-project-path" title={projectDir}>
              {projectDir.split(/[\\/]/).filter(Boolean).pop()}
            </span>
          ) : (
            <span className="lm-settings-val lm-project-none">未选择</span>
          )}
        </div>
        {projectDir ? <div className="lm-project-full-path">{projectDir}</div> : null}
        <div className="lm-settings-actions">
          <button
            type="button"
            className={`lm-btn lm-btn-sm ${projectDir ? "lm-btn-secondary" : "lm-btn-accent"}`}
            onClick={onPickProject}
          >
            {projectDir ? "更换" : "选择文件夹"}
          </button>
          {projectDir ? (
            <button type="button" className="lm-btn lm-btn-ghost lm-btn-sm" onClick={onClearProject}>
              关闭
            </button>
          ) : null}
        </div>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">软件数据目录</span>
          <span className="lm-settings-val" title={config.workspaceDir}>
            {workspaceLabel}
          </span>
        </div>
        <p className="lm-settings-caption">系统保存案件与配置，侧栏不会打开此处。</p>
      </div>

      {apiBase ? (
        <div className="lm-settings-group lm-settings-surface" data-testid="lm-desk-settings">
          <label className="lm-settings-field">
            <span className="lm-settings-key">合同批次目录</span>
            <input
              className="lm-input"
              value={batchDir}
              data-testid="lm-desk-contract-batch-dir"
              placeholder="例如 materials/contract-batch"
              onChange={(e) => setBatchDir(e.target.value)}
            />
          </label>
          <div className="lm-settings-actions">
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              disabled={deskBusy}
              data-testid="lm-desk-settings-save"
              onClick={() => void saveDeskSettings()}
            >
              {deskBusy ? "保存中…" : "保存"}
            </button>
          </div>
          {deskHint ? (
            <p className="lm-settings-caption" role="status">
              {deskHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
