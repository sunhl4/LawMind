import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "../api-client";

type DocRow = {
  name: string;
  relativePath: string;
  sizeBytes: number;
  modifiedAt: string;
};

type Props = {
  apiBase: string;
  matterId: string;
};

export function MatterLocalDocIndex(props: Props): ReactNode {
  const { apiBase, matterId } = props;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);

  useEffect(() => {
    if (!open || !apiBase || !matterId) {
      return;
    }
    setLoading(true);
    setError(null);
    void apiGetJson<{
      ok?: boolean;
      documents?: DocRow[];
      error?: string;
      hint?: string;
    }>(
      apiBase,
      `/api/integrations/filesystem/documents?matterId=${encodeURIComponent(matterId)}`,
    )
      .then((r) => {
        if (r.ok === false || r.error) {
          setError(r.hint ?? r.error ?? "无法加载文档索引");
          setDocs([]);
          return;
        }
        setDocs(r.documents ?? []);
      })
      .catch((e) => setError(errorMessage(e, "无法加载文档索引")))
      .finally(() => setLoading(false));
  }, [open, apiBase, matterId]);

  return (
    <details
      className="lm-matter-local-docs"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>本地文档索引（cases 目录）</summary>
      <p className="lm-meta">
        只读列出本案文件夹中的文件元数据，便于与 DMS 导出物对照；不替代审核台验收。
      </p>
      {loading ? <p className="lm-meta">加载中…</p> : null}
      {error ? <p className="lm-error">{error}</p> : null}
      {!loading && !error && docs.length === 0 ? (
        <p className="lm-meta">本案目录下暂无可索引文件。</p>
      ) : null}
      {docs.length > 0 ? (
        <ul className="lm-list lm-matter-local-docs-list">
          {docs.slice(0, 40).map((d) => (
            <li key={d.relativePath}>
              <span className="lm-list-title">{d.relativePath}</span>
              <span className="lm-meta">
                {(d.sizeBytes / 1024).toFixed(1)} KB · {d.modifiedAt.slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {docs.length > 40 ? (
        <p className="lm-meta">另有 {docs.length - 40} 个文件未显示。</p>
      ) : null}
    </details>
  );
}
