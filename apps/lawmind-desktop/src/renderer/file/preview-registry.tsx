/**
 * Middle-column preview registry: extension → kind is in preview-kind.ts;
 * kind → panel lives here so P2/P4 swap components without touching the editor shell.
 */
import type { ReactNode } from "react";
import type { FilePreviewKind, OpenFileTab, RootKey } from "./file-workbench-types";
import { LawmindWordRevisionSurface } from "./LawmindWordRevisionSurface";
import { openDeliverableInWps } from "../canvas/host-actions";

export type PreviewHeaderActions = {
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  onRevealSource: () => void;
  onOpenWithSystem: () => void;
  busy?: boolean;
};

export function PreviewCommonActions(props: {
  root: RootKey;
  relPath: string;
  actions: PreviewHeaderActions;
}): ReactNode {
  const { root, relPath, actions } = props;
  return (
    <>
      {actions.onAddToChatContext ? (
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-sm"
          onClick={() => actions.onAddToChatContext?.({ root, relPath, kind: "file" })}
        >
          在对话中引用
        </button>
      ) : null}
      <button
        type="button"
        className="lm-btn lm-btn-secondary lm-btn-sm"
        onClick={actions.onRevealSource}
      >
        在访达中显示
      </button>
      <button
        type="button"
        className="lm-btn lm-btn-sm"
        disabled={actions.busy}
        onClick={actions.onOpenWithSystem}
      >
        用本机应用打开
      </button>
    </>
  );
}

export function ImagePreviewPanel(props: {
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
}): ReactNode {
  const { tab, actions } = props;
  return (
    <div className="lm-editor-pane lm-image-preview-pane" data-testid="lm-preview-image">
      <div className="lm-editor-header">
        <div className="lm-editor-breadcrumb">
          <span className="lm-editor-root-badge">{tab.root}</span>
          <span className="lm-editor-path">{tab.path || "(根)"}</span>
        </div>
        <div className="lm-editor-actions">
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
      <div className="lm-image-preview-body">
        {tab.dataUrl ? (
          <img className="lm-image-preview-img" src={tab.dataUrl} alt={tab.name} />
        ) : (
          <p className="lm-meta">读不到这张图。</p>
        )}
        <p className="lm-meta lm-image-preview-caption">{tab.name}</p>
      </div>
    </div>
  );
}

export function FallbackPreviewPanel(props: {
  tab: OpenFileTab;
  actions: PreviewHeaderActions;
}): ReactNode {
  const { tab, actions } = props;
  const mode = tab.fallbackMode ?? "office";
  return (
    <div className="lm-editor-pane lm-office-doc-pane" data-testid={`lm-preview-fallback-${tab.kind}`}>
      <div className="lm-editor-header">
        <div className="lm-editor-breadcrumb">
          <span className="lm-editor-root-badge">{tab.root}</span>
          <span className="lm-editor-path">{tab.path || "(根)"}</span>
        </div>
      </div>
      <div className="lm-office-doc-body">
        <p className="lm-office-doc-title">{tab.name}</p>
        <p className="lm-office-doc-copy">
          {mode === "binary"
            ? "该文件为二进制格式，无法在此纯文本编辑器中打开。可用本机应用查看，或在访达中打开。"
            : tab.kind === "pdf"
              ? "PDF 预览即将接入中栏。请先用本机应用打开，或在对话中让助手读取。"
              : "本页暂不支持该 Office 格式的版式预览。请用本机已安装的 Office 或 WPS 等打开编辑。"}
        </p>
        <div className="lm-office-doc-actions">
          <PreviewCommonActions root={tab.root} relPath={tab.path} actions={actions} />
        </div>
      </div>
    </div>
  );
}

export function WordPreviewPanel(props: {
  tab: OpenFileTab;
  apiBase: string;
  projectDir: string | null;
  busy: boolean;
  onRevealSource: () => void;
  onError: (message: string) => void;
}): ReactNode {
  const { tab, apiBase, projectDir, busy, onRevealSource, onError } = props;
  return (
    <div className="lm-editor-pane lm-office-doc-pane lm-word-surface-pane" data-testid="lm-preview-word">
      <LawmindWordRevisionSurface
        apiBase={apiBase}
        projectDir={projectDir}
        root={tab.root}
        relPath={tab.path}
        fileName={tab.name}
        busy={busy}
        onRevealSource={onRevealSource}
        onOpenWithSystem={() => {
          void openDeliverableInWps(tab.path, tab.root).then((r) => {
            if (!r.ok) {
              onError(r.error ?? "无法用 WPS 打开该文件。");
            }
          });
        }}
      />
    </div>
  );
}

/**
 * Kinds that keep their panel mounted while inactive so scroll/edit state survives tab switches.
 * pdf/xlsx/media stay mounted once their real viewers land (P2/P4); until then they remount as fallback.
 */
export function keepsMountedWhileInactive(kind: FilePreviewKind): boolean {
  return (
    kind === "word" ||
    kind === "image" ||
    kind === "pdf" ||
    kind === "xlsx" ||
    kind === "media" ||
    kind === "eml" ||
    kind === "zip" ||
    kind === "doc"
  );
}
