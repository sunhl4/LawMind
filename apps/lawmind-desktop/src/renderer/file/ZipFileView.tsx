/**
 * Middle-column zip listing (names only; no extract-to-disk).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "../api-client";
import type { OpenFileTab } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type ZipEntryPreview = {
  path: string;
  size: number;
  directory: boolean;
};

export type ZipListingResponse = {
  ok: true;
  entries: ZipEntryPreview[];
  truncated: boolean;
};

export type ZipFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

export function ZipFileView(props: ZipFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [entries, setEntries] = useState<ZipEntryPreview[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const requestKey = useMemo(
    () => `${apiBase}|${tab.root}|${tab.path}|${tab.mtimeMs}`,
    [apiBase, tab.root, tab.path, tab.mtimeMs],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setLoadError(null);
    setEntries([]);
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份压缩包。");
      setBusy(false);
    } else {
      void (async () => {
        try {
          const q = new URLSearchParams({ root: tab.root, path: tab.path });
          const body = await apiGetJson<ZipListingResponse>(
            apiBase,
            `/api/fs/zip-listing?${q.toString()}`,
          );
          if (cancelled) {
            return;
          }
          setEntries(body.entries);
          setTruncated(body.truncated);
        } catch (err) {
          if (!cancelled) {
            setLoadError(errorMessage(err, "读不到这份压缩包。"));
          }
        } finally {
          if (!cancelled) {
            setBusy(false);
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [requestKey, apiBase, tab.root, tab.path]);

  return (
    <div className="lm-editor-pane lm-zip-preview-pane" data-testid="lm-preview-zip">
      <div className="lm-editor-header">
        <div className="lm-editor-breadcrumb">
          <span className="lm-editor-root-badge">{tab.root}</span>
          <span className="lm-editor-path">{tab.path || "(根)"}</span>
        </div>
        <div className="lm-editor-actions">
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      {loadError ? (
        <div className="lm-office-doc-body">
          <p className="lm-office-doc-title">{tab.name}</p>
          <p className="lm-office-doc-copy" role="alert">
            {loadError}
          </p>
        </div>
      ) : busy ? (
        <div className="lm-office-doc-body">
          <p className="lm-meta">正在打开压缩包…</p>
        </div>
      ) : (
        <div className="lm-zip-preview-body lm-scroll">
          <p className="lm-meta">只读清单，不解压到磁盘。需要归档时在对话中引用本压缩包。</p>
          <ul className="lm-zip-entry-list" data-testid="lm-zip-entries">
            {entries.map((entry) => (
              <li key={entry.path} data-directory={entry.directory ? "1" : "0"}>
                <span className="lm-zip-entry-name">{entry.path}</span>
                {!entry.directory ? (
                  <span className="lm-zip-entry-size">{entry.size.toLocaleString()} B</span>
                ) : null}
              </li>
            ))}
          </ul>
          {truncated ? <p className="lm-meta">条目过多，已截断显示。</p> : null}
        </div>
      )}
    </div>
  );
}
