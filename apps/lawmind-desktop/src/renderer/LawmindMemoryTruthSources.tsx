import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemorySourceLayer } from "../../../../src/lawmind/memory/index.ts";
import { apiGetJson, errorMessage } from "./api-client.js";
import { mapMemoryLayerToScope, memoryScopeLabel } from "./lawmind-memory-scope.js";

type Props = {
  apiBase: string;
  matterId?: string;
  assistantId?: string;
  /** Settings page already shows section title; omit duplicate eyebrow. */
  embedInSettings?: boolean;
};

type SourceTextPreview = {
  path: string;
  charCount: number;
  truncated: boolean;
  text: string;
};

function shortPath(rel: string): string {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

export function LawmindMemoryTruthSources({
  apiBase,
  matterId,
  assistantId,
  embedInSettings = false,
}: Props) {
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
      const j = await apiGetJson<{
        ok?: boolean;
        layers?: MemorySourceLayer[];
        memorySources?: MemorySourceLayer[];
      }>(apiBase, `/api/memory/sources?${params.toString()}`);
      const rows = Array.isArray(j.layers)
        ? j.layers
        : Array.isArray(j.memorySources)
          ? j.memorySources
          : null;
      if (!j.ok || !rows) {
        throw new Error("加载档案失败");
      }
      setLayers(rows);
    } catch (e) {
      setErr(errorMessage(e, "加载档案失败"));
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
        setErr(errorMessage(e, "读取预览失败"));
        setPreview(null);
        setPreviewPath(null);
      } finally {
        setPreviewBusy(false);
      }
    },
    [apiBase, preview, previewPath],
  );

  const groupEntries = Object.entries(grouped);

  return (
    <section
      className={`lm-memory-truth${embedInSettings ? " lm-memory-truth--embed" : ""}`}
      aria-label="办案沉淀档案"
    >
      {!embedInSettings ? (
        <header className="lm-memory-truth__header">
          <span className="lm-memory-truth__eyebrow">档案一览</span>
          <button
            type="button"
            className="lm-btn lm-btn-ghost lm-btn-sm"
            onClick={() => void reload()}
            disabled={loading}
          >
            刷新
          </button>
        </header>
      ) : null}
      {err ? (
        <div className="memory-inspector__error" role="alert">
          {err}
        </div>
      ) : null}
      {loading ? <p className="lm-settings-caption">加载中…</p> : null}
      {!loading && layers.length === 0 ? (
        <div className="lm-memory-empty">
          <p className="lm-memory-empty__title">尚无档案条目</p>
          <p className="lm-memory-empty__desc">办案与确认建议后会逐渐出现在这里。</p>
        </div>
      ) : null}
      <div className="lm-memory-truth__groups">
        {groupEntries.map(([scope, rows], index) => (
          <details
            key={scope}
            className="lm-memory-fold lm-memory-truth__group"
            open={scope === "matter" || scope === "lawyer" || (!embedInSettings && index === 0)}
          >
            <summary>
              <span className="lm-memory-fold__label">{memoryScopeLabel(scope)}</span>
              <span className="lm-memory-fold__count">{rows.length}</span>
            </summary>
            <div className="lm-memory-fold__body">
              <ul className="lm-memory-truth__list">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className={`lm-memory-truth__row${row.activeForEngine ? " is-active" : ""}`}
                  >
                    <div className="lm-memory-truth__row-main">
                      <div className="lm-memory-truth__row-title">
                        <span className="lm-memory-truth__name">{row.label}</span>
                        {row.activeForEngine ? (
                          <span className="lm-badge lm-badge-done" title="当前办案会参考">
                            在用
                          </span>
                        ) : null}
                      </div>
                      <p className="lm-memory-truth__row-meta">
                        {row.exists ? `${row.charCount} 字` : "尚未建立"}
                        {!embedInSettings ? (
                          <>
                            <span className="lm-memory-truth__sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="lm-mono" title={row.relativePath}>
                              {shortPath(row.relativePath)}
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    {row.exists ? (
                      <button
                        type="button"
                        className="lm-btn lm-btn-ghost lm-btn-sm"
                        disabled={previewBusy}
                        onClick={() => void loadPreview(row.relativePath)}
                      >
                        {previewPath === row.relativePath ? "收起" : "预览"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
      {preview ? (
        <div className="lm-memory-truth__preview">
          <header>
            <strong title={preview.path}>{shortPath(preview.path)}</strong>
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
