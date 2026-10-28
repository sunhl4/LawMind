import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { LawmindSettingsPracticePlaybook } from "./LawmindSettingsPracticePlaybook";
import { LawmindSettingsPlaybooks } from "./LawmindSettingsPlaybooks";
import { LawmindSettingsWorkspaceCare } from "./LawmindSettingsWorkspaceCare";
import { LawmindSettingsUserStandards } from "./LawmindSettingsUserStandards";
import { workspaceLocationCautionMessage } from "./lawmind-workspace-location";
import { readChatHomeDir, writeChatHomeDir, CHAT_HOME_DIR_EVENT } from "./lawmind-chat-home-dir";
import { useWorkspaceVolumeFacts } from "./use-workspace-volume";
import type { LawmindSettingsAppConfig } from "./lawmind-settings-models.ts";
import type { LawmindDaemonPayload } from "./lawmind-app-data.ts";

type Props = {
  config: LawmindSettingsAppConfig;
  apiBase?: string;
  workspaceLabel: string;
  projectDir: string | null;
  onPickProject: () => void;
  onClearProject: () => void;
  /** 离开设置，打开「整理电脑上的资料」整页。 */
  onOpenArchiveOrganize?: () => void;
};

export function LawmindSettingsWorkspace(props: Props): ReactNode {
  const { config, apiBase, workspaceLabel, projectDir, onPickProject, onClearProject, onOpenArchiveOrganize } =
    props;
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonHint, setDaemonHint] = useState<string | null>(null);
  const [daemon, setDaemon] = useState<LawmindDaemonPayload | null>(null);
  const [mounts, setMounts] = useState<Array<{ id: string; absPath: string; label?: string; matterId?: string }>>(
    [],
  );
  const [chatHomeDir, setChatHomeDir] = useState<string | null>(() => readChatHomeDir());
  const workspaceVolume = useWorkspaceVolumeFacts(config.workspaceDir);
  const locationCaution = workspaceLocationCautionMessage(config.workspaceDir, workspaceVolume);

  const refreshMounts = useCallback(async () => {
    const list = window.lawmindDesktop?.listHostFolders;
    if (!list) {
      return;
    }
    const res = await list();
    if (res.ok && Array.isArray(res.mounts)) {
      setMounts(res.mounts);
    }
  }, []);

  useEffect(() => {
    if (!apiBase?.trim()) {
      // 显式 `undefined`：与下面的 cleanup 返回保持一致的返回形状（oxlint consistent-return）。
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      daemon?: LawmindDaemonPayload;
    }>(apiBase, "/api/daemon")
      .then((j) => {
        if (!cancelled && j.ok) {
          setDaemon(j.daemon ?? null);
        }
      })
      .catch(() => {
        /* ignore */
      });
    void refreshMounts();
    const syncChatHome = () => setChatHomeDir(readChatHomeDir());
    window.addEventListener(CHAT_HOME_DIR_EVENT, syncChatHome);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_HOME_DIR_EVENT, syncChatHome);
    };
  }, [apiBase, refreshMounts]);

  async function patchDaemon(action: "enable" | "disable"): Promise<void> {
    if (!apiBase?.trim()) {
      return;
    }
    setDaemonBusy(true);
    setDaemonHint(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          daemon?: LawmindDaemonPayload;
          message?: string;
          error?: string;
        },
        { action: "enable" | "disable" }
      >(apiBase, "/api/daemon", "POST", { action });
      if (!j.ok) {
        setDaemonHint(j.message ?? j.error ?? "未能更新关窗后续跑");
        return;
      }
      setDaemon(j.daemon ?? null);
      setDaemonHint(
        j.message ??
          (action === "enable" ? "已开启。" : "已关闭。"),
      );
    } catch (e) {
      setDaemonHint(errorMessage(e, "未能更新关窗后续跑"));
    } finally {
      setDaemonBusy(false);
    }
  }

  return (
    <div className="lm-settings-section" id="lawmind-settings-workspace">
      <div className="lm-settings-group lm-settings-surface" data-testid="lm-host-folders">
        <div className="lm-settings-row">
          <span className="lm-settings-key">本机文件夹</span>
          <span className="lm-settings-val">
            {mounts.length > 0 || projectDir ? `${Math.max(mounts.length, projectDir ? 1 : 0)} 个` : "未选择"}
          </span>
        </div>
        {(mounts.length > 0 ? mounts : projectDir ? [{ id: "project", absPath: projectDir }] : []).map((m) => (
          <div key={m.id} className="lm-host-folder-row">
            <div className="lm-project-full-path" title={m.absPath}>
              {m.label || m.absPath.split(/[\\/]/).filter(Boolean).pop()}
            </div>
            <div className="lm-settings-actions">
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                onClick={() => {
                  void (async () => {
                    if (window.lawmindDesktop?.removeHostFolder) {
                      await window.lawmindDesktop.removeHostFolder(m.id);
                      await refreshMounts();
                      return;
                    }
                    onClearProject();
                  })();
                }}
                title="撤销此本机文件夹"
              >
                撤销
              </button>
            </div>
          </div>
        ))}
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm lm-btn-accent"
            onClick={() => {
              void (async () => {
                const pick = window.lawmindDesktop?.pickProject;
                const add = window.lawmindDesktop?.addHostFolder;
                if (!pick || !add) {
                  onPickProject();
                  return;
                }
                const chosen = await pick();
                if (chosen.ok && chosen.path) {
                  await add({ path: chosen.path });
                  await refreshMounts();
                }
              })();
            }}
          >
            添加文件夹
          </button>
        </div>
        <p className="lm-settings-caption">助手可阅读。改文件先收进本案。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-chat-home-dir">
        <div className="lm-settings-row">
          <span className="lm-settings-key">默认工作区</span>
          <span className="lm-settings-val">{chatHomeDir ? "已另选" : "本机目录"}</span>
        </div>
        <p className="lm-project-full-path" title={chatHomeDir || projectDir || config.workspaceDir}>
          {chatHomeDir || projectDir || config.workspaceDir}
        </p>
        <div className="lm-settings-actions">
          <button
            type="button"
            className="lm-btn lm-btn-sm lm-btn-accent"
            onClick={() => {
              void (async () => {
                const pick = window.lawmindDesktop?.pickFolder ?? window.lawmindDesktop?.pickProject;
                if (!pick) {
                  return;
                }
                const chosen = await pick();
                if (chosen.ok && chosen.path?.trim()) {
                  const next = chosen.path.trim();
                  writeChatHomeDir(next);
                  setChatHomeDir(next);
                }
              })();
            }}
          >
            选择目录…
          </button>
          {chatHomeDir ? (
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={() => {
                writeChatHomeDir(null);
                setChatHomeDir(null);
              }}
            >
              改回本机目录
            </button>
          ) : null}
        </div>
        <p className="lm-settings-caption">最上面的新建对话用这个目录。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-workspace-location">
        <div className="lm-settings-row">
          <span className="lm-settings-key">案件数据目录</span>
          <span className="lm-settings-val" title={workspaceLabel}>
            {workspaceLabel}
          </span>
        </div>
        <p className="lm-project-full-path" data-testid="lm-workspace-path">
          {config.workspaceDir}
        </p>
        <div className="lm-settings-actions">
          {typeof window !== "undefined" && window.lawmindDesktop?.showItemInFolder ? (
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-sm"
              data-testid="lm-workspace-reveal"
              onClick={() => {
                void window.lawmindDesktop?.showItemInFolder(config.workspaceDir);
              }}
            >
              在文件夹中显示
            </button>
          ) : null}
        </div>
        {locationCaution ? (
          <div className="lm-callout lm-callout-warn" role="status" data-testid="lm-workspace-sync-warn">
            <p className="lm-callout-body">{locationCaution}</p>
          </div>
        ) : (
          <p className="lm-settings-caption">案件和草稿在这里。</p>
        )}
      </div>

      <div className="lm-settings-group lm-settings-surface" data-testid="lm-archive-organize-entry">
        <div className="lm-settings-row">
          <span className="lm-settings-key">整理电脑上的资料</span>
          <button
            type="button"
            className="lm-btn lm-btn-secondary lm-btn-sm"
            data-testid="lm-archive-organize-open"
            onClick={() => onOpenArchiveOrganize?.()}
          >
            打开
          </button>
        </div>
        <p className="lm-settings-caption">该建案就建案，一般资料按类型收好。</p>
      </div>

      {apiBase ? (
        <div className="lm-settings-group lm-settings-surface" data-testid="lm-daemon-settings">
          <div className="lm-settings-row">
            <span className="lm-settings-key">关桌面后继续办件</span>
            <span className="lm-settings-val" data-testid="lm-daemon-status">
              {daemon?.running ? "后台办件运行中" : daemon?.enabled ? "已开启，退出后继续" : "未开"}
            </span>
          </div>
          <p className="lm-settings-caption">关掉窗口后，已排的办件继续。</p>
          {daemon?.recap ? (
            // 回执的真相源在服务端（引擎单测覆盖文案）；这里只负责显示，不重新推导「算不算异常」。
            <div
              className={`lm-callout ${
                daemon.supervisionGaveUp
                  ? "lm-callout-danger"
                  : daemon.heartbeatStale
                    ? "lm-callout-warn"
                    : "lm-callout-muted"
              }`}
              role="status"
              data-testid="lm-daemon-recap"
            >
              <p className="lm-callout-title">{daemon.recap.headline}</p>
              <ul className="lm-callout-body">
                {daemon.recap.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="lm-settings-actions">
            <button
              type="button"
              className={`lm-btn lm-btn-sm ${daemon?.enabled ? "lm-btn-secondary" : "lm-btn-accent"}`}
              data-testid="lm-daemon-toggle"
              disabled={daemonBusy}
              onClick={() => void patchDaemon(daemon?.enabled ? "disable" : "enable")}
            >
              {daemon?.enabled ? "关闭" : "开启"}
            </button>
          </div>
          {daemonHint ? (
            <p className="lm-settings-caption" role="status">
              {daemonHint}
            </p>
          ) : null}
        </div>
      ) : null}

      {apiBase ? <LawmindSettingsPracticePlaybook apiBase={apiBase} /> : null}
      {apiBase ? <LawmindSettingsPlaybooks apiBase={apiBase} /> : null}
      {apiBase ? <LawmindSettingsUserStandards apiBase={apiBase} /> : null}
      {apiBase ? <LawmindSettingsWorkspaceCare apiBase={apiBase} /> : null}
    </div>
  );
}
