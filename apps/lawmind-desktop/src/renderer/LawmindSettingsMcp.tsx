import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiGetJson, apiSendJson, errorMessage } from "./api-client";

type McpRow = {
  id: string;
  label: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  allowWrites: boolean;
  secretRef?: string;
  hasSecretRef?: boolean;
};

type Props = { apiBase: string };

function desktopBridge() {
  return window.lawmindDesktop as
    | {
        saveMcpServerSecret?: (p: { id: string; secret: string }) => Promise<{ ok?: boolean; error?: string }>;
        deleteMcpServerSecret?: (p: { id: string }) => Promise<{ ok?: boolean }>;
      }
    | undefined;
}

export function LawmindSettingsMcp(props: Props): ReactNode {
  const { apiBase } = props;
  const [servers, setServers] = useState<McpRow[]>([]);
  const [highSecurity, setHighSecurity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [draftId, setDraftId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftTransport, setDraftTransport] = useState<"stdio" | "http">("stdio");
  const [draftCommand, setDraftCommand] = useState("node");
  const [draftArgs, setDraftArgs] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftSecret, setDraftSecret] = useState("");

  const reload = useCallback(async () => {
    if (!apiBase) {
      return;
    }
    try {
      const r = await apiGetJson<{
        ok?: boolean;
        servers?: McpRow[];
        highSecurityMode?: boolean;
      }>(apiBase, "/api/mcp/servers");
      setServers(r.servers ?? []);
      setHighSecurity(r.highSecurityMode === true);
    } catch (e) {
      setError(errorMessage(e, "无法加载外部对接配置"));
    }
  }, [apiBase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function persist(next: McpRow[]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload = next.map(({ hasSecretRef: _ignored, ...row }) => row);
      const r = await apiSendJson<{ ok?: boolean; servers?: McpRow[]; error?: string }, { servers: McpRow[] }>(
        apiBase,
        "/api/mcp/servers",
        "PUT",
        { servers: payload },
      );
      if (!r.ok) {
        throw new Error(r.error ?? "保存失败");
      }
      setServers(r.servers ?? next);
    } catch (e) {
      setError(errorMessage(e, "保存外部对接配置失败"));
    } finally {
      setBusy(false);
    }
  }

  async function addServer(): Promise<void> {
    const id = draftId.trim();
    if (!id) {
      setError("请填写对接编号");
      return;
    }
    if (draftTransport === "http" && !draftUrl.trim()) {
      setError("请填写网络地址（http 或 https）。");
      return;
    }
    const args = draftArgs
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const row: McpRow =
      draftTransport === "http"
        ? {
            id,
            label: draftLabel.trim() || id,
            transport: "http",
            url: draftUrl.trim(),
            enabled: false,
            allowWrites: false,
            secretRef: draftSecret.trim() ? `mcp:${id}` : undefined,
          }
        : {
            id,
            label: draftLabel.trim() || id,
            transport: "stdio",
            command: draftCommand.trim() || "node",
            args,
            enabled: false,
            allowWrites: false,
            secretRef: draftSecret.trim() ? `mcp:${id}` : undefined,
          };
    const desktop = desktopBridge();
    if (draftSecret.trim() && desktop?.saveMcpServerSecret) {
      const saved = await desktop.saveMcpServerSecret({ id, secret: draftSecret.trim() });
      if (!saved?.ok) {
        setError(saved?.error ?? "密钥未能写入钥匙串，未添加对接。");
        return;
      }
    }
    await persist([...servers.filter((s) => s.id !== id), row]);
    setDraftId("");
    setDraftLabel("");
    setDraftSecret("");
    setDraftUrl("");
  }

  async function testServer(id: string): Promise<void> {
    setBusy(true);
    setTestHint(null);
    try {
      const r = await apiSendJson<
        { ok?: boolean; tools?: Array<{ name: string; exposed?: boolean }>; error?: string },
        Record<string, never>
      >(apiBase, `/api/mcp/servers/${encodeURIComponent(id)}/test`, "POST", {});
      if (!r.ok) {
        throw new Error(r.error ?? "连通失败");
      }
      const n = r.tools?.length ?? 0;
      const exposed = r.tools?.filter((t) => t.exposed).length ?? 0;
      setTestHint(`${id}：已列出 ${n} 项，本回合可见 ${exposed} 项（改写类默认隐藏）。`);
    } catch (e) {
      setError(errorMessage(e, "测试连通失败"));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWrites(row: McpRow): Promise<void> {
    if (!row.allowWrites) {
      const ok = window.confirm("打开后，该外部对接可以改文件或外发。确定打开？");
      if (!ok) {
        return;
      }
    }
    await persist(servers.map((s) => (s.id === row.id ? { ...s, allowWrites: !s.allowWrites } : s)));
  }

  async function removeServer(id: string): Promise<void> {
    const desktop = desktopBridge();
    await desktop?.deleteMcpServerSecret?.({ id });
    await persist(servers.filter((row) => row.id !== id));
  }

  return (
    <details className="lm-settings-advanced" data-testid="lm-settings-mcp">
      <summary>
        <span className="lm-settings-advanced__label">外部对接</span>
        <span className="lm-settings-advanced__hint">{highSecurity ? "高安全已关" : "本机客户端"}</span>
      </summary>
      <div className="lm-settings-advanced-body">
        <p className="lm-settings-caption">
          把外部只读服务接到 LawMind。默认不能改文件；要开写权限须你确认。高安全模式下强制关闭。
        </p>
        <p className="lm-settings-caption">
          给 Cursor 等外部编辑器读本机卷宗，仍用只读服务：
          <code className="lm-md-code">pnpm lawmind:mcp:readonly</code>
        </p>
        {error ? (
          <p className="lm-settings-caption lm-settings-caption--warn" role="alert">
            {error}
          </p>
        ) : null}
        {testHint ? (
          <p className="lm-settings-caption" role="status">
            {testHint}
          </p>
        ) : null}
        {servers.length === 0 ? <p className="lm-settings-caption">尚未添加外部对接。</p> : null}
        {servers.map((s) => (
          <div key={s.id} className="lm-settings-row" data-testid={`lm-mcp-row-${s.id}`}>
            <div className="lm-settings-row-stack">
              <span className="lm-settings-key">{s.label}</span>
              <span className="lm-settings-caption" style={{ margin: 0 }}>
                {s.transport === "http" ? "网络地址" : "本地程序"}
                {s.command ? ` · ${s.command}` : ""}
                {s.url ? ` · ${s.url}` : ""}
                {s.allowWrites ? " · 允许写" : " · 只读"}
              </span>
            </div>
            <div className="lm-settings-row-actions">
              <button
                type="button"
                className={`lm-btn lm-btn-sm ${s.enabled ? "lm-btn-accent" : "lm-btn-secondary"}`}
                disabled={busy || highSecurity}
                aria-label={s.enabled ? `停用 ${s.label}` : `启用 ${s.label}`}
                onClick={() => void persist(servers.map((row) => (row.id === s.id ? { ...row, enabled: !row.enabled } : row)))}
              >
                {s.enabled ? "已启用" : "未启用"}
              </button>
              <button
                type="button"
                className={`lm-btn lm-btn-sm ${s.allowWrites ? "lm-btn-accent" : "lm-btn-secondary"}`}
                disabled={busy || highSecurity}
                aria-label={s.allowWrites ? `改为只读 ${s.label}` : `允许写入 ${s.label}`}
                onClick={() => void toggleWrites(s)}
              >
                {s.allowWrites ? "可写" : "只读"}
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-sm lm-btn-secondary"
                disabled={busy || highSecurity}
                aria-label={`测试 ${s.label} 连通`}
                onClick={() => void testServer(s.id)}
              >
                测试连通
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-sm lm-btn-ghost"
                disabled={busy || highSecurity}
                aria-label={`移除 ${s.label}`}
                onClick={() => void removeServer(s.id)}
              >
                移除
              </button>
            </div>
          </div>
        ))}
        <div className="lm-settings-group" data-testid="lm-mcp-add">
          <fieldset className="lm-settings-row-stack" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="lm-settings-key">添加对接</legend>
            <div className="lm-settings-row-actions">
              <button
                type="button"
                className={`lm-btn lm-btn-sm ${draftTransport === "stdio" ? "lm-btn-accent" : "lm-btn-secondary"}`}
                disabled={busy || highSecurity}
                aria-pressed={draftTransport === "stdio"}
                onClick={() => setDraftTransport("stdio")}
              >
                本地程序
              </button>
              <button
                type="button"
                className={`lm-btn lm-btn-sm ${draftTransport === "http" ? "lm-btn-accent" : "lm-btn-secondary"}`}
                disabled={busy || highSecurity}
                aria-pressed={draftTransport === "http"}
                onClick={() => setDraftTransport("http")}
              >
                网络地址
              </button>
            </div>
          </fieldset>
          <label className="lm-settings-key">
            编号
            <input
              className="lm-input"
              value={draftId}
              onChange={(e) => setDraftId(e.target.value)}
              placeholder="英文字母开头"
            />
          </label>
          <input
            className="lm-input"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="显示名"
          />
          {draftTransport === "stdio" ? (
            <>
              <input
                className="lm-input"
                value={draftCommand}
                onChange={(e) => setDraftCommand(e.target.value)}
                placeholder="启动程序，例如 node"
              />
              <input
                className="lm-input"
                value={draftArgs}
                onChange={(e) => setDraftArgs(e.target.value)}
                placeholder="启动参数（空格分隔）"
              />
            </>
          ) : (
            <input
              className="lm-input"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="https:// 或本机 http://127.0.0.1"
            />
          )}
          <input
            className="lm-input"
            type="password"
            value={draftSecret}
            onChange={(e) => setDraftSecret(e.target.value)}
            placeholder="密钥（只存钥匙串引用，可选）"
          />
          <button type="button" className="lm-btn lm-btn-sm lm-btn-secondary" disabled={busy || highSecurity} onClick={() => void addServer()}>
            添加
          </button>
        </div>
      </div>
    </details>
  );
}
