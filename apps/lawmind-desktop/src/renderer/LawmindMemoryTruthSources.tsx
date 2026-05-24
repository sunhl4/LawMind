import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { apiGetJson, errorMessage } from "./api-client.js";
import { mapMemoryLayerToScope, memoryScopeLabel } from "./lawmind-memory-scope.js";

type Props = {
  apiBase: string;
  matterId?: string;
  assistantId?: string;
};

type SourceTextPreview = {
  path: string;
  charCount: number;
  truncated: boolean;
  text: string;
};

export function LawmindMemoryTruthSources({ apiBase, matterId, assistantId }: Props) {
  const [layers, setLayers] = useState<MemorySourceLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<SourceTextPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (matterId) {
        params.set("matterId", matterId);
      }
      if (assistantId) {
        params.set("assistantId", assistantId);
      }
      const j = await apiGetJson<{ ok?: boolean; layers?: MemorySourceLayer[] }>(
        apiBase,
        `/api/memory/sources?${params.toString()}`,
      );
      if (!j.ok || !Array.isArray(j.layers)) {
        throw new Error("加载记忆真相源失败");
      }
      setLayers(j.layers);
    } catch (e) {
      setErr(errorMessage(e, "加载记忆真相源失败"));
      setLayers([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, matterId, assistantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grouped = useMemo(() => {
    const out: Record<string, MemorySourceLayer[]> = {};
    for (const layer of layers) {
      const scope = mapMemoryLayerToScope(layer);
      out[scope] = out[scope] ?? [];
      out[scope].push(layer);
    }
    return out;
  }, [layers]);

  const loadPreview = useCallback(
    async (relPath: string) => {
      if (previewPath === relPath && preview) {
        setPreviewPath(null);
        setPreview(null);
        return;
      }
      setPreviewBusy(true);
      setPreviewPath(relPath);
      try {
        const j = await apiGetJson<{
          ok?: boolean;
          path?: string;
          charCount?: number;
          truncated?: boolean;
          text?: string;
        }>(
          apiBase,
          `/api/memory/source-text?path=${encodeURIComponent(relPath)}&maxChars=2400`,
        );
        if (!j.ok || typeof j.text !== "string") {
          throw new Error("预览失败");
        }
        setPreview({
          path: j.path ?? relPath,
          charCount: j.charCount ?? j.text.length,
          truncated: Boolean(j.truncated),
          text: j.text,
        });
      } catch (e) {
        setErr(errorMessage(e, "读取文件预览失败"));
        setPreview(null);
        setPreviewPath(null);
      } finally {
        setPreviewBusy(false);
      }
    },
    [apiBase, preview, previewPath],
  );

  return (
    <section className="lm-memory-truth" aria-label="记忆真相源">
      <header className="lm-memory-truth__header">
        <h4>记忆真相源（按 scope）</h4>
        <button type="button" className="lm-btn-ghost" onClick={() => void reload()} disabled={loading}>
          刷新
        </button>
      </header>
      <p className="lm-hint">
        展示 Agent 可能读取的工作区记忆层；点击「预览」查看当前文件片段（只读）。
      </p>
      {err ? <div className="memory-inspector__error">{err}</div> : null}
      {loading ? <p>加载真相源…</p> : null}
      {!loading && layers.length === 0 ? <p className="lm-meta">暂无记忆层报告。</p> : null}
      {Object.entries(grouped).map(([scope, rows]) => (
        <details key={scope} className="lm-memory-truth__group" open={scope === "matter"}>
          <summary>
            <strong>{memoryScopeLabel(scope)}</strong>
            <span className="lm-meta">（{rows.length}）</span>
          </summary>
          <table className="lm-memory-truth__table">
            <thead>
              <tr>
                <th>层</th>
                <th>路径</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.activeForEngine ? "lm-memory-truth__active" : undefined}>
                  <td>
                    {row.label}
                    {row.inAgentSystemPrompt ? (
                      <span className="lm-badge lm-badge--ok" title="进入 Agent system prompt">
                        prompt
                      </span>
                    ) : null}
                    {row.activeForEngine ? (
                      <span className="lm-badge" title="本回合引擎选中">
                        生效
                      </span>
                    ) : null}
                  </td>
                  <td className="lm-mono">{row.relativePath}</td>
                  <td>
                    {row.exists ? `${row.charCount} 字` : "缺失"}
                  </td>
                  <td>
                    {row.exists ? (
                      <button
                        type="button"
                        className="lm-btn-ghost"
                        disabled={previewBusy}
                        onClick={() => void loadPreview(row.relativePath)}
                      >
                        {previewPath === row.relativePath ? "收起" : "预览"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
      {preview ? (
        <div className="lm-memory-truth__preview">
          <header>
            <strong>{preview.path}</strong>
            <span className="lm-meta">
              {preview.charCount} 字{preview.truncated ? "（已截断）" : ""}
            </span>
          </header>
          <pre>{preview.text}</pre>
        </div>
      ) : null}
    </section>
  );
}
