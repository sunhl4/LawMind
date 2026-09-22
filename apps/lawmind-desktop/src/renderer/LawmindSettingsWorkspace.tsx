import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { LawmindSettingsPracticePlaybook } from "./LawmindSettingsPracticePlaybook";
import { LawmindSettingsUserStandards } from "./LawmindSettingsUserStandards";
import type { LawmindSettingsAppConfig } from "./lawmind-settings-models.ts";
import type { LawmindDaemonPayload } from "./lawmind-app-data.ts";

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
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonHint, setDaemonHint] = useState<string | null>(null);
  const [daemon, setDaemon] = useState<LawmindDaemonPayload | null>(null);
  /** 后台日志按需拉取：它是排障材料，不该在打开设置时无条件读盘。 */
  const [daemonLog, setDaemonLog] = useState<{ lines: string[]; exists: boolean } | null>(null);
  const [daemonLogBusy, setDaemonLogBusy] = useState(false);
  const [mounts, setMounts] = useState<Array<{ id: string; absPath: string; label?: string; matterId?: string }>>(
    [],
  );

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

  /**
   * 拉后台日志。
   *
   * 为什么必须有这个入口：「关桌面后继续办件」出问题时的现场在
   * `lawmind/daemon.log` 里，而此前产品没有任何地方能读到它 ——
   * 等于要律师自己去摸文件系统。按需拉取，不打开设置就读盘。
   */
  const loadDaemonLog = useCallback(async () => {
    if (!apiBase?.trim()) {
      // 不返回任何值：与整段 async 函数的「无返回值」形状保持一致
      // （oxlint consistent-return：async 函数里显式 return undefined 会让其它路径不合规）。
      return;
    }
    setDaemonLogBusy(true);
    try {
      const j = await apiGetJson<{ log?: { lines: string[]; exists: boolean } }>(
        apiBase,
        "/api/daemon/log",
      );
      setDaemonLog(j.log ?? { lines: [], exists: false });
    } catch (e) {
      setDeskHint(errorMessage(e, "读不到后台日志"));
    } finally {
      setDaemonLogBusy(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase?.trim()) {
      // 显式 `undefined`：与下面的 cleanup 返回保持一致的返回形状（oxlint consistent-return）。
      return undefined;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      settings?: { contractBatchRelativeDir?: string; auditExternalAnchorUrl?: string };
    }>(apiBase, "/api/workspace/desk-settings")
      .then((j) => {
        if (!cancelled && j.ok) {
          setBatchDir(j.settings?.contractBatchRelativeDir ?? "");
        }
      })
      .catch(() => {
        /* ignore */
      });
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
    return () => {
      cancelled = true;
    };
  }, [apiBase, refreshMounts]);

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

  async function patchDaemon(action: "enable" | "disable" | "start" | "stop"): Promise<void> {
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
        { action: "enable" | "disable" | "start" | "stop" }
      >(apiBase, "/api/daemon", "POST", { action });
      if (!j.ok) {
        setDaemonHint(j.message ?? j.error ?? "未能更新关窗后续跑");
        return;
      }
      setDaemon(j.daemon ?? null);
      setDaemonHint(
        j.message ??
          (action === "start"
            ? "桌面开着时由本窗口办件。关掉 LawMind 后才会在这台电脑上继续。"
            : action === "enable"
              ? "已开启。关掉 LawMind 后仍会在这台电脑上办件。"
              : action === "stop"
                ? "已停止后台办件。"
                : "已关闭关窗后续跑。"),
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
            <div className="lm-project-full-path">
              {m.label || m.absPath.split(/[\\/]/).filter(Boolean).pop()}
              {m.matterId ? ` · 绑定 ${m.matterId}` : ""}
            </div>
            <div className="lm-settings-actions">
              <input
                className="lm-input"
                aria-label={`绑定案件 ${m.label || m.id}`}
                placeholder="绑定案件 ID（可选）"
                defaultValue={m.matterId ?? ""}
                onBlur={(e) => {
                  const bind = window.lawmindDesktop?.bindHostFolder;
                  if (!bind) {
                    return;
                  }
                  void bind({
                    id: m.id,
                    matterId: e.target.value.trim() || undefined,
                  }).then(() => refreshMounts());
                }}
              />
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
        <p className="lm-settings-caption">助手只能阅读这些文件夹。写入请用「收进本案」。绑定案件后，其他案件会话不能读该文件夹正文。更多选项见本机能力。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">软件数据目录</span>
          <span className="lm-settings-val" title={config.workspaceDir}>
            {workspaceLabel}
          </span>
        </div>
        <p className="lm-settings-caption">系统数据目录。</p>
      </div>

      {apiBase ? <HistoricalScanSettings apiBase={apiBase} /> : null}

      {apiBase ? (
        <div className="lm-settings-group lm-settings-surface" data-testid="lm-daemon-settings">
          <div className="lm-settings-row">
            <span className="lm-settings-key">关桌面后继续办件</span>
            <span className="lm-settings-val" data-testid="lm-daemon-status">
              {daemon?.running ? "后台办件运行中" : daemon?.enabled ? "已开启，退出后继续" : "未开"}
            </span>
          </div>
          <p className="lm-settings-caption">
            只在这台电脑上跑自动办件，不把案卷送到云上。回来只看「在办 / 待我拍板」。
          </p>
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
          <details
            className="lm-settings-advanced"
            data-testid="lm-daemon-log"
            onToggle={(e) => {
              // 展开时才读盘（一次就够，重复展开不重复请求）。
              if ((e.target as HTMLDetailsElement).open && !daemonLog) {
                void loadDaemonLog();
              }
            }}
          >
            <summary>
              <span className="lm-settings-advanced__label">后台办件日志</span>
              <span className="lm-settings-advanced__hint">出问题时给工程看</span>
            </summary>
            <div className="lm-settings-advanced-body">
              {daemonLogBusy ? (
                <p className="lm-meta" role="status" aria-busy="true">
                  正在读取…
                </p>
              ) : daemonLog && !daemonLog.exists ? (
                <p className="lm-meta">还没有日志。后台办件跑过之后才会产生。</p>
              ) : daemonLog && daemonLog.lines.length === 0 ? (
                <p className="lm-meta">日志是空的。</p>
              ) : daemonLog ? (
                <pre className="lm-daemon-log" data-testid="lm-daemon-log-lines">
                  {daemonLog.lines.join("\n")}
                </pre>
              ) : (
                <p className="lm-meta">展开后读取最近 200 行。</p>
              )}
            </div>
          </details>
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
            {daemon?.running ? (
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                data-testid="lm-daemon-start"
                disabled={daemonBusy}
                onClick={() => void patchDaemon("stop")}
              >
                停止后台办件
              </button>
            ) : null}
          </div>
          {daemonHint ? (
            <p className="lm-settings-caption" role="status">
              {daemonHint}
            </p>
          ) : null}
        </div>
      ) : null}

      {apiBase ? <LawmindSettingsPracticePlaybook apiBase={apiBase} /> : null}
      {apiBase ? <LawmindSettingsUserStandards apiBase={apiBase} /> : null}

      {apiBase ? (
        <details className="lm-settings-advanced" data-testid="lm-desk-settings">
          <summary>
            <span className="lm-settings-advanced__label">合同批次目录</span>
            <span className="lm-settings-advanced__hint">批量审合同</span>
          </summary>
          <div className="lm-settings-advanced-body">
            <label className="lm-settings-field">
              <span className="lm-settings-key">相对路径</span>
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
        </details>
      ) : null}
    </div>
  );
}

type ScanRoot = { id: string; absPath: string; label?: string };
type ScanJob = {
  scanId?: string;
  stats?: {
    cataloged?: number;
    organizedFolders?: number;
    messyFiles?: number;
    habitsQueued?: number;
    truncated?: boolean;
    filesUnchanged?: number;
    filesChanged?: number;
    incremental?: boolean;
  };
};

function HistoricalScanSettings(props: { apiBase: string }): ReactNode {
  const { apiBase } = props;
  const [roots, setRoots] = useState<ScanRoot[]>([]);
  const [latest, setLatest] = useState<ScanJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState("");

  async function refresh(): Promise<void> {
    const j = await apiGetJson<{ ok?: boolean; roots?: ScanRoot[]; latest?: ScanJob | null }>(
      apiBase,
      "/api/historical-scan",
    );
    if (j.ok) {
      setRoots(j.roots ?? []);
      setLatest(j.latest ?? null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refresh()
      .catch(() => {
        if (!cancelled) {
          /* ignore */
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function addRoot(absPath: string): Promise<void> {
    const trimmed = absPath.trim();
    if (!trimmed) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; error?: string; roots?: ScanRoot[] }, { absPath: string }>(
        apiBase,
        "/api/historical-scan/roots",
        "POST",
        { absPath: trimmed },
      );
      if (!j.ok) {
        setHint(j.error === "max_roots" ? "最多 3 个扫描根。" : j.error ?? "未能添加");
        return;
      }
      setRoots(j.roots ?? []);
      setPathDraft("");
    } catch (e) {
      setHint(errorMessage(e, "未能添加"));
    } finally {
      setBusy(false);
    }
  }

  async function pickAndAdd(): Promise<void> {
    const picked = await window.lawmindDesktop?.pickFolder?.();
    if (picked?.ok && picked.path) {
      await addRoot(picked.path);
    }
  }

  async function removeRoot(rootId: string): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; roots?: ScanRoot[] }, { rootId: string }>(
        apiBase,
        "/api/historical-scan/roots/remove",
        "POST",
        { rootId },
      );
      if (!j.ok) {
        setHint("未能移除");
        return;
      }
      setRoots(j.roots ?? []);
    } catch (e) {
      setHint(errorMessage(e, "未能移除"));
    } finally {
      setBusy(false);
    }
  }

  async function runScan(): Promise<void> {
    setBusy(true);
    setHint(null);
    try {
      const j = await apiSendJson<{ ok?: boolean; job?: ScanJob; error?: string }, Record<string, never>>(
        apiBase,
        "/api/historical-scan/run",
        "POST",
        {},
      );
      if (!j.ok) {
        setHint(j.error ?? "扫描失败");
        return;
      }
      setLatest(j.job ?? null);
      const s = j.job?.stats;
      setHint(
        `扫到 ${s?.cataloged ?? 0} 份：整理夹 ${s?.organizedFolders ?? 0} 个，未分类 ${s?.messyFiles ?? 0} 份。重复改法已进「记忆」待确认。`,
      );
    } catch (e) {
      setHint(errorMessage(e, "扫描失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lm-settings-group lm-settings-surface" data-testid="lm-historical-scan">
      <div className="lm-settings-row">
        <span className="lm-settings-key">扫描历史材料</span>
        <span className="lm-settings-val">{roots.length}/3 个根</span>
      </div>
      <p className="lm-settings-caption">
        按案件分好的文件夹会建议建案；杂烩目录只进未分类桶。重复 ≥5 次的改法进待确认（冲突取最新）。不静默写入习惯。
      </p>
      {roots.length > 0 ? (
        <ul className="lm-settings-caption" data-testid="lm-historical-scan-roots">
          {roots.map((r) => (
            <li key={r.id} title={r.absPath}>
              {r.label ?? r.absPath}{" "}
              <button
                type="button"
                className="lm-btn lm-btn-ghost lm-btn-sm"
                disabled={busy}
                data-testid="lm-historical-scan-remove"
                onClick={() => void removeRoot(r.id)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="lm-settings-field">
        <span className="lm-settings-key">文件夹路径</span>
        <input
          className="lm-input"
          value={pathDraft}
          data-testid="lm-historical-scan-path"
          placeholder="本机已整理卷宗或杂烩目录"
          onChange={(e) => setPathDraft(e.target.value)}
        />
      </label>
      <div className="lm-settings-actions">
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          data-testid="lm-historical-scan-add"
          onClick={() => void addRoot(pathDraft)}
        >
          添加根
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-secondary lm-btn-sm"
          disabled={busy}
          data-testid="lm-historical-scan-pick"
          onClick={() => void pickAndAdd()}
        >
          选择文件夹
        </button>
        <button
          type="button"
          className="lm-btn lm-btn-accent lm-btn-sm"
          disabled={busy || roots.length === 0}
          data-testid="lm-historical-scan-run"
          onClick={() => void runScan()}
        >
          {busy ? "扫描中…" : "开始扫描"}
        </button>
      </div>
      {latest?.stats ? (
        <p className="lm-settings-caption" data-testid="lm-historical-scan-latest">
          上次：{latest.stats.cataloged ?? 0} 份
          {latest.stats.incremental ? ` · 未变 ${latest.stats.filesUnchanged ?? 0} · 有变 ${latest.stats.filesChanged ?? 0}` : ""}
          {latest.stats.truncated ? "（已截断）" : ""}
        </p>
      ) : null}
      {hint ? (
        <p className="lm-settings-caption" role="status">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
