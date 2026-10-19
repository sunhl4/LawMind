/**
 * Middle-column `.doc` view. The engine reads the OLE container in-process, so
 * there is no conversion step and no confirmation: we show the body text and
 * say plainly that layout and existing revisions are only preserved on export.
 */
import { useEffect, useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "../api-client";
import type { OpenFileTab } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type DocFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

type DocTextResponse =
  | { ok: true; relativePath: string; converted: boolean; tool?: string; text: string; truncated?: boolean }
  | { ok: false; error: string };

export function DocFileView(props: DocFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase.trim()) {
      setError("本机服务未连接。");
      return undefined;
    }
    let cancelled = false;
    void apiSendJson<DocTextResponse, { root: string; path: string }>(
      apiBase,
      "/api/fs/convert-doc",
      "POST",
      { root: tab.root, path: tab.path },
    )
      .then((body) => {
        if (cancelled) {
          return;
        }
        if (!body.ok) {
          throw new Error(body.error);
        }
        setText(body.text);
        setTruncated(body.truncated === true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err, "未能读取这份 .doc。"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, tab.root, tab.path]);

  return (
    <div className="lm-editor-pane lm-office-doc-pane" data-testid="lm-preview-doc">
      <div className="lm-editor-header">
        <div className="lm-editor-breadcrumb">
          <span className="lm-editor-root-badge">{tab.root}</span>
          <span className="lm-editor-path">{tab.path || "(根)"}</span>
        </div>
        <div className="lm-editor-actions">
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      <div className="lm-office-doc-body">
        <p className="lm-office-doc-title">{tab.name}</p>
        <p className="lm-office-doc-copy">
          旧版 Word（.doc），这里按正文显示。原文件不改；出修订稿时另出同名 .docx，页眉页脚与表格版式不随正文带过去。
        </p>
        {text !== null ? (
          <pre className="lm-office-doc-copy lm-doc-preview lm-scroll" data-testid="lm-doc-preview-text">
            {text}
          </pre>
        ) : null}
        {truncated ? <p className="lm-meta">正文较长，这里只显示前一部分。</p> : null}
        {error ? (
          <p className="lm-office-doc-copy" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
