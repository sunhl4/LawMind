import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type HostPolicy = {
  mode?: string;
  allowHostCommands?: boolean;
  hostCommandLevel?: string;
  fullDiskAccessOptIn?: boolean;
  allowCrossMatterMounts?: boolean;
  forceMatterMode?: boolean;
  allowSessionCommands?: boolean;
  spotlightEnabled?: boolean;
};

type Props = {
  apiBase?: string;
};

const MODE_LABELS: Record<string, string> = {
  matter: "仅本案",
  mounts: "已选文件夹",
  locate: "本机查找",
  command: "受控命令",
};

const LEVEL_LABELS: Record<string, string> = {
  office: "办公",
  workspace: "工作副本",
  session: "本会话",
};

export function LawmindSettingsHostAccess(props: Props): ReactNode {
  const { apiBase } = props;
  const [policy, setPolicy] = useState<HostPolicy>({});
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [indexHint, setIndexHint] = useState<string | null>(null);
  const [events, setEvents] = useState<
    Array<{ at?: string; action?: string; path?: string; ok?: boolean }>
  >([]);

  useEffect(() => {
    if (!apiBase?.trim()) {
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; policy?: HostPolicy; hostAccess?: HostPolicy }>(
      apiBase,
      "/api/host-access",
    )
      .then((j) => {
        if (!cancelled && j.ok) {
          setPolicy(j.policy ?? j.hostAccess ?? {});
        }
      })
      .catch(() => {
        /* ignore */
      });
    void apiGetJson<{
      ok?: boolean;
      events?: Array<{ at?: string; action?: string; path?: string; ok?: boolean }>;
    }>(apiBase, "/api/host-access/log?limit=8")
      .then((j) => {
        if (!cancelled && j.ok) {
          setEvents(j.events ?? []);
        }
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  async function patch(next: HostPolicy): Promise<void> {
    if (!apiBase?.trim()) {
      return;
    }
    setBusy(true);
    setHint(null);
    try {
      const merged = { ...policy, ...next };
      const j = await apiSendJson<
        { ok?: boolean; hostAccess?: HostPolicy; message?: string },
        { hostAccess: HostPolicy }
      >(apiBase, "/api/policy/workspace", "PATCH", { hostAccess: merged });
      if (j.ok) {
        setPolicy(j.hostAccess ?? merged);
        setHint("已保存");
      } else {
        setHint(j.message ?? "未能保存");
      }
    } catch (e) {
      setHint(errorMessage(e, "未能保存"));
    } finally {
      setBusy(false);
    }
  }

  async function rebuildIndex(): Promise<void> {
    if (!apiBase?.trim()) {
      return;
    }
    setIndexHint(null);
    try {
      const j = await apiSendJson<
        { ok?: boolean; files?: number; mounts?: number; message?: string },
        Record<string, never>
      >(apiBase, "/api/host-access/index/rebuild", "POST", {});
      setIndexHint(j.ok ? `已更新本机查找（${j.files ?? 0} 个文件）` : (j.message ?? "未能更新"));
    } catch (e) {
      setIndexHint(errorMessage(e, "未能更新本机查找"));
    }
  }

  function openFullDiskSettings(): void {
    const url =
      window.lawmindDesktop && "openExternal" in window.lawmindDesktop
        ? "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
        : "";
    if (url) {
      void window.lawmindDesktop?.openExternal?.(url);
    }
    void patch({ fullDiskAccessOptIn: true });
  }

  return (
    <div className="lm-settings-section" id="lawmind-settings-host" data-testid="lm-host-access">
      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">本机范围</span>
          <select
            className="lm-select"
            value={policy.mode ?? "mounts"}
            disabled={busy}
            onChange={(e) => void patch({ mode: e.target.value })}
            aria-label="本机范围"
          >
            {Object.entries(MODE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="lm-settings-caption">默认只使用已选本机文件夹。本机查找只先列出文件名，点开后才读正文。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">允许本机命令</span>
          <label className="lm-toggle">
            <input
              type="checkbox"
              checked={policy.allowHostCommands === true}
              disabled={busy}
              onChange={(e) => void patch({ allowHostCommands: e.target.checked })}
            />
            打开
          </label>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">命令档位</span>
          <select
            className="lm-select"
            value={policy.hostCommandLevel ?? "office"}
            disabled={busy || policy.allowHostCommands !== true}
            onChange={(e) => void patch({ hostCommandLevel: e.target.value })}
            aria-label="命令档位"
          >
            {Object.entries(LEVEL_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <p className="lm-settings-caption">办公档可跑文书工具。工作副本再加 git / Python。本会话档须每次确认，律所默认关闭。</p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">对照旧案材料</span>
          <label className="lm-toggle">
            <input
              type="checkbox"
              checked={policy.allowCrossMatterMounts === true}
              disabled={busy}
              onChange={(e) => void patch({ allowCrossMatterMounts: e.target.checked })}
            />
            允许（仍不读对立客户正文）
          </label>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">强制仅本案</span>
          <label className="lm-toggle">
            <input
              type="checkbox"
              checked={policy.forceMatterMode === true}
              disabled={busy}
              onChange={(e) => void patch({ forceMatterMode: e.target.checked })}
            />
            律所锁定
          </label>
        </div>
        <div className="lm-settings-row">
          <span className="lm-settings-key">本会话命令</span>
          <label className="lm-toggle">
            <input
              type="checkbox"
              checked={policy.allowSessionCommands !== false}
              disabled={busy}
              onChange={(e) => void patch({ allowSessionCommands: e.target.checked })}
            />
            Solo 可开；律所默认关
          </label>
        </div>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">完全磁盘访问</span>
          <button type="button" className="lm-btn lm-btn-sm lm-btn-secondary" onClick={openFullDiskSettings}>
            打开系统设置
          </button>
        </div>
        <p className="lm-settings-caption">
          {policy.fullDiskAccessOptIn
            ? "已记录：请在系统设置中确认。即使打开，助手仍按案件隔离，不能写全盘。"
            : "可选增强。不打开也能使用已选本机文件夹。"}
        </p>
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">本机查找索引</span>
          <button type="button" className="lm-btn lm-btn-sm lm-btn-secondary" onClick={() => void rebuildIndex()}>
            更新
          </button>
        </div>
        {indexHint ? <p className="lm-settings-caption">{indexHint}</p> : null}
      </div>

      <div className="lm-settings-group lm-settings-surface">
        <div className="lm-settings-row">
          <span className="lm-settings-key">最近本机访问</span>
        </div>
        {events.length === 0 ? (
          <p className="lm-settings-caption">尚无记录。供撤销核对与安全调查，不是可信证明。</p>
        ) : (
          <ul className="lm-host-log" aria-label="最近本机访问">
            {events
              .slice()
              .toReversed()
              .map((ev, i) => (
                <li key={`${ev.at ?? "t"}-${i}`}>
                  {ev.action ?? "访问"}
                  {ev.path ? ` · ${ev.path}` : ""}
                  {ev.ok === false ? " · 未通过" : ""}
                </li>
              ))}
          </ul>
        )}
      </div>
      {hint ? <p className="lm-settings-caption">{hint}</p> : null}
    </div>
  );
}
