import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";
import { LawmindSettingsPracticePlaybook } from "./LawmindSettingsPracticePlaybook";
import { LawmindSettingsUserStandards } from "./LawmindSettingsUserStandards";
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
  const [anchorUrl, setAnchorUrl] = useState("");
  const [deskBusy, setDeskBusy] = useState(false);
  const [deskHint, setDeskHint] = useState<string | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonHint, setDaemonHint] = useState<string | null>(null);
  const [daemon, setDaemon] = useState<{
    enabled?: boolean;
    running?: boolean;
    lastTickAt?: string;
  } | null>(null);

  useEffect(() => {
    if (!apiBase?.trim()) {
      return;
    }
    let cancelled = false;
    void apiGetJson<{
      ok?: boolean;
      settings?: { contractBatchRelativeDir?: string; auditExternalAnchorUrl?: string };
    }>(apiBase, "/api/workspace/desk-settings")
      .then((j) => {
        if (!cancelled && j.ok) {
          setBatchDir(j.settings?.contractBatchRelativeDir ?? "");
          setAnchorUrl(j.settings?.auditExternalAnchorUrl ?? "");
        }
      })
      .catch(() => {
        /* ignore */
      });
    void apiGetJson<{
      ok?: boolean;
      daemon?: { enabled?: boolean; running?: boolean; lastTickAt?: string };
    }>(apiBase, "/api/daemon")
      .then((j) => {
        if (!cancelled && j.ok) {
          setDaemon(j.daemon ?? null);
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
          settings?: { contractBatchRelativeDir?: string; auditExternalAnchorUrl?: string };
          message?: string;
          error?: string;
        },
        { contractBatchRelativeDir: string; auditExternalAnchorUrl: string }
      >(apiBase, "/api/workspace/desk-settings", "POST", {
        contractBatchRelativeDir: batchDir.trim(),
        auditExternalAnchorUrl: anchorUrl.trim(),
      });
      if (!j.ok) {
        setDeskHint(j.message ?? j.error ?? "保存失败");
        return;
      }
      setBatchDir(j.settings?.contractBatchRelativeDir ?? batchDir.trim());
      setAnchorUrl(j.settings?.auditExternalAnchorUrl ?? anchorUrl.trim());
      setDeskHint("已保存");
    } catch (e) {
      setDeskHint(errorMessage(e, "保存失败"));
    } finally {
      setDeskBusy(false);
    }
  }

  async function verifyAuditExternalAnchor(): Promise<void> {
    if (!apiBase?.trim() || !anchorUrl.trim()) {
      setVerifyMsg("请先填写外部锚 URL");
      return;
    }
    setVerifyBusy(true);
    setVerifyMsg(null);
    try {
      const j = await apiSendJson<
        {
          ok?: boolean;
          status?: string;
          detail?: string;
          report?: string;
          error?: string;
          message?: string;
        },
        { externalAnchorUrl: string }
      >(apiBase, "/api/audit/verify-external", "POST", {
        externalAnchorUrl: anchorUrl.trim(),
      });
      if (!j.ok) {
        setVerifyMsg(j.message ?? j.error ?? j.detail ?? "验证失败");
        return;
      }
      setVerifyMsg(`[${j.status}] ${j.detail ?? ""}${j.report ? `\n${j.report}` : ""}`);
    } catch (e) {
      setVerifyMsg(errorMessage(e, "验证失败"));
    } finally {
      setVerifyBusy(false);
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
          daemon?: { enabled?: boolean; running?: boolean; lastTickAt?: string };
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
            <button
              type="button"
              className="lm-btn lm-btn-ghost lm-btn-sm"
              onClick={onClearProject}
              title="取消侧栏材料夹，不是离开设置"
            >
              清除
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

      {apiBase ? (
        <details className="lm-settings-advanced" data-testid="lm-audit-external-anchor">
          <summary>
            <span className="lm-settings-advanced__label">审计外部锚</span>
            <span className="lm-settings-advanced__hint">防篡改摘要</span>
          </summary>
          <div className="lm-settings-advanced-body">
            <p className="lm-settings-caption">
              将审计链摘要同步到工作区外（U 盘、iCloud/OneDrive 本地目录，或 HTTPS 只写 URL）。
              摘要包含链尾 root hash 与 HMAC 签名，可用于事后验证链是否被截断或篡改。
              保存后需重启本地服务方可生效。
            </p>
            <label className="lm-settings-field">
              <span className="lm-settings-key">外部锚 URL / 路径</span>
              <input
                className="lm-input"
                value={anchorUrl}
                data-testid="lm-audit-external-anchor-url"
                placeholder="例如 file:///Users/您/备份/lawmind-anchor.json 或 https://..."
                onChange={(e) => setAnchorUrl(e.target.value)}
              />
            </label>
            <div className="lm-settings-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                disabled={deskBusy}
                data-testid="lm-audit-external-anchor-save"
                onClick={() => void saveDeskSettings()}
              >
                {deskBusy ? "保存中…" : "保存"}
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-accent lm-btn-sm"
                disabled={verifyBusy || !anchorUrl.trim()}
                data-testid="lm-audit-external-anchor-verify"
                onClick={() => void verifyAuditExternalAnchor()}
              >
                {verifyBusy ? "验证中…" : "验证审计链"}
              </button>
            </div>
            {deskHint ? (
              <p className="lm-settings-caption" role="status">
                {deskHint}
              </p>
            ) : null}
            {verifyMsg ? (
              <pre
                className="lm-settings-caption"
                role="status"
                data-testid="lm-audit-external-anchor-verify-msg"
                style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}
              >
                {verifyMsg}
              </pre>
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
