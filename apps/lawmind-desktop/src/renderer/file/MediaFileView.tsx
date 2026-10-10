/**
 * Middle-column audio/video preview. Loads /api/fs/raw with auth into a blob URL
 * so the media element can play (custom Authorization headers cannot be set on
 * <audio>/<video> src). Large files may take a moment to buffer.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchApi, fetchWithLoopbackAuthRetry, errorMessage } from "../api-client";
import type { OpenFileTab, RootKey } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type MediaFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

function rawUrl(apiBase: string, root: RootKey, relPath: string): string {
  const q = new URLSearchParams({ root, path: relPath });
  return `${apiBase.replace(/\/$/, "")}/api/fs/raw?${q.toString()}`;
}

function isVideoPath(relPath: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(relPath);
}

export function MediaFileView(props: MediaFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const video = isVideoPath(tab.path);
  const requestKey = useMemo(
    () => `${apiBase}|${tab.root}|${tab.path}|${tab.mtimeMs}`,
    [apiBase, tab.root, tab.path, tab.mtimeMs],
  );

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    setBusy(true);
    setLoadError(null);
    setBlobUrl(null);
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这份音视频。");
      setBusy(false);
    } else {
      void (async () => {
        try {
          const { response } = await fetchWithLoopbackAuthRetry(apiBase, (base) =>
            fetchApi(rawUrl(base, tab.root, tab.path), {}, { tag: "mediaRaw" }),
          );
          if (!response.ok) {
            throw new Error(`读不到这份文件（${response.status}）。`);
          }
          const blob = await response.blob();
          if (cancelled) {
            return;
          }
          const url = URL.createObjectURL(blob);
          revoked = url;
          setBlobUrl(url);
        } catch (err) {
          if (!cancelled) {
            setLoadError(errorMessage(err, "读不到这份音视频。"));
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
      if (revoked) {
        URL.revokeObjectURL(revoked);
      }
    };
  }, [requestKey, apiBase, tab.root, tab.path]);

  return (
    <div className="lm-editor-pane lm-media-preview-pane" data-testid="lm-preview-media">
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
      ) : busy || !blobUrl ? (
        <div className="lm-office-doc-body">
          <p className="lm-meta">正在打开音视频…</p>
        </div>
      ) : (
        <div className="lm-media-preview-body">
          {video ? (
            <video className="lm-media-preview-player" controls src={blobUrl} />
          ) : (
            <audio className="lm-media-preview-player" controls src={blobUrl} />
          )}
          <p className="lm-meta lm-media-preview-caption">{tab.name}</p>
        </div>
      )}
    </div>
  );
}
