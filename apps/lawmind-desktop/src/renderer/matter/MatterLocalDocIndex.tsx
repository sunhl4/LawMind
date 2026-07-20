import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "../api-client";

type DocRow = {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
  webUrl?: string;
  source?: string;
};

type ConnectorId = "filesystem" | "imanage" | "sharepoint";

type Props = {
  apiBase: string;
  matterId: string;
};

export function MatterLocalDocIndex(props: Props): ReactNode {
  const { apiBase, matterId } = props;
  const [open, setOpen] = useState(false);
  const [connector, setConnector] = useState<ConnectorId>("filesystem");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);

  useEffect(() => {
    if (!open || !apiBase || !matterId) {
      return;
    }
    setLoading(true);
    setError(null);
    setHint(null);
    void apiGetJson<{
      ok?: boolean;
      documents?: DocRow[];
      error?: string;
      hint?: string;
      mode?: string;
    }>(
      apiBase,
      `/api/integrations/${encodeURIComponent(connector)}/documents?matterId=${encodeURIComponent(matterId)}`,
    )
      .then((r) => {
        if (r.ok === false || r.error) {
          setError(r.hint ?? r.error ?? "无法加载文档索引");
          setDocs([]);
          return;
        }
        setDocs(r.documents ?? []);
        if (connector === "imanage" || r.mode === "fixture" || r.hint?.includes("演示")) {
          setHint(
            connector === "imanage"
              ? "iManage 当前为演示索引（fixture），非生产 DMS；Firm 凭证就绪前请勿当作正式检索。"
              : (r.hint ?? null),
          );
        }
      })
      .catch((e) => setError(errorMessage(e, "无法加载文档索引")))
      .finally(() => setLoading(false));
  }, [open, apiBase, matterId, connector]);

  return (
    <details
      className="lm-matter-local-docs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>文档索引（本地 / DMS）</summary>
      <p className="lm-meta">
        只读列出本案相关文件元数据；DMS 连接器未配置 Firm 密钥时仅返回演示数据。
      </p>
      <label className="lm-field" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span className="lm-meta">来源</span>
        <select
          className="lm-compose-select"
          value={connector}
          onChange={(e) => setConnector(e.target.value as ConnectorId)}
        >
          <option value="filesystem">本机 cases 目录</option>
          <option value="imanage">iManage（演示）</option>
          <option value="sharepoint">SharePoint</option>
        </select>
      </label>
      {hint ? <p className="lm-callout lm-callout-muted lm-meta">{hint}</p> : null}
      {loading ? <p className="lm-meta">加载中…</p> : null}
      {error ? <p className="lm-error">{error}</p> : null}
      {!loading && !error && docs.length === 0 ? (
        <p className="lm-meta">暂无可索引文件。</p>
      ) : null}
      {docs.length > 0 ? (
        <ul className="lm-list lm-matter-local-docs-list">
          {docs.slice(0, 40).map((d) => (
            <li key={d.relativePath}>
              <span className="lm-list-title">{d.relativePath}</span>
              <span className="lm-meta">
                {(d.sizeBytes / 1024).toFixed(1)} KB · {d.modifiedAt.slice(0, 10)}
                {d.source ? ` · ${d.source}` : ""}
                {d.webUrl?.trim() ? (
                  <>
                    {" · "}
                    <a href={d.webUrl} target="_blank" rel="noopener noreferrer">
                      打开链接
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
