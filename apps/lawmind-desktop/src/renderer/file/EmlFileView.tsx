/**
 * Middle-column .eml preview: headers, body skim, attachment names.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson, errorMessage } from "../api-client";
import type { OpenFileTab } from "./file-workbench-types";
import { parseEmlPreview, type EmlPreview } from "./eml-preview";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type EmlFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

type FsReadResponse = {
  ok: true;
  content: string;
};

export function EmlFileView(props: EmlFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [preview, setPreview] = useState<EmlPreview | null>(null);
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
    setPreview(null);
    if (!apiBase.trim()) {
      setLoadError("本机服务未连接，打不开这封邮件。");
      setBusy(false);
    } else {
      void (async () => {
        try {
          const q = new URLSearchParams({ root: tab.root, path: tab.path });
          const body = await apiGetJson<FsReadResponse>(apiBase, `/api/fs/read?${q.toString()}`);
          if (cancelled) {
            return;
          }
          setPreview(parseEmlPreview(body.content));
        } catch (err) {
          if (!cancelled) {
            setLoadError(errorMessage(err, "读不到这封邮件。二进制或过大的 eml 请用本机应用打开。"));
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
    <div className="lm-editor-pane lm-eml-preview-pane" data-testid="lm-preview-eml">
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
      ) : busy || !preview ? (
        <div className="lm-office-doc-body">
          <p className="lm-meta">正在打开邮件…</p>
        </div>
      ) : (
        <div className="lm-eml-preview-body lm-scroll">
          <dl className="lm-eml-headers">
            <div>
              <dt>主题</dt>
              <dd>{preview.subject || "（无主题）"}</dd>
            </div>
            <div>
              <dt>发件人</dt>
              <dd>{preview.from || "—"}</dd>
            </div>
            <div>
              <dt>收件人</dt>
              <dd>{preview.to || "—"}</dd>
            </div>
            <div>
              <dt>日期</dt>
              <dd>{preview.date || "—"}</dd>
            </div>
          </dl>
          {preview.attachments.length > 0 ? (
            <div className="lm-eml-attachments">
              <p className="lm-meta">附件</p>
              <ul>
                {preview.attachments.map((att) => (
                  <li key={att.fileName}>{att.fileName}</li>
                ))}
              </ul>
              <p className="lm-meta">附件请用「在对话中引用」整封邮件，或让助手收进本案。</p>
            </div>
          ) : null}
          <pre className="lm-eml-body">{preview.bodyText || "（无正文）"}</pre>
        </div>
      )}
    </div>
  );
}
