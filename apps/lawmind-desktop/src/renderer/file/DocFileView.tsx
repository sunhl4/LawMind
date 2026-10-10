/**
 * Middle-column .doc gate: convert to sibling *.converted.docx (lawyer confirms),
 * then open the docx in the Word surface.
 */
import { useState, type ReactNode } from "react";
import { apiSendJson, errorMessage } from "../api-client";
import { requestOpenWorkspaceFile } from "../lawmind-workspace-file-open";
import type { OpenFileTab } from "./file-workbench-types";
import { PreviewCommonActions, type PreviewHeaderActions } from "./preview-registry";

export type DocFileViewProps = {
  apiBase: string;
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
};

type ConvertResponse =
  | { ok: true; relativePath: string; converted: boolean; tool?: string }
  | { ok: false; error: string };

export function DocFileView(props: DocFileViewProps): ReactNode {
  const { apiBase, tab, actions } = props;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const convert = async () => {
    if (!apiBase.trim()) {
      setError("本机服务未连接。");
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body = await apiSendJson<ConvertResponse, { root: string; path: string }>(
        apiBase,
        "/api/fs/convert-doc",
        "POST",
        { root: tab.root, path: tab.path },
      );
      if (!body.ok) {
        throw new Error(body.error);
      }
      setNote(
        body.converted
          ? `已生成 ${body.relativePath}${body.tool ? `（${body.tool}）` : ""}，正在打开…`
          : `已有预览副本 ${body.relativePath}，正在打开…`,
      );
      requestOpenWorkspaceFile(body.relativePath, tab.root);
    } catch (err) {
      setError(errorMessage(err, "未能转换这份 .doc。"));
    } finally {
      setBusy(false);
    }
  };

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
          这是旧版 Word（.doc）。中栏修订面只读 .docx。确认后会在同目录生成「
          {tab.name.replace(/\.doc$/i, "")}.converted.docx」副本再打开；不改原文件。
        </p>
        <div className="lm-office-doc-actions">
          <button
            type="button"
            className="lm-btn lm-btn-accent lm-btn-sm"
            data-testid="lm-doc-convert"
            disabled={busy || actions.busy}
            onClick={() => void convert()}
          >
            {busy ? "正在转换…" : "转换为 docx 并打开"}
          </button>
        </div>
        {note ? (
          <p className="lm-meta" role="status">
            {note}
          </p>
        ) : null}
        {error ? (
          <p className="lm-office-doc-copy" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
