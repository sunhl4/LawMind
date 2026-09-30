import { useEffect, useRef, useState, type Dispatch, SetStateAction } from "react";
import { type RootKey, type OpenFileTab } from "./file-workbench-types";
import { getFileIcon } from "./file-workbench-fs";
import { isContractReviewCandidatePath } from "../lawmind-file-chat-context";
import { lawyerCanvasTitle } from "../lawmind-explorer-lawyer-view";
import { LawmindWordRevisionSurface } from "./LawmindWordRevisionSurface";
import { CanvasFileView } from "../canvas/CanvasFileView";
import { useLawmindCanvasKind } from "../canvas/theme";
import {
  LAWMIND_CANVAS_EXPORT_RESULT_EVENT,
  openDeliverableInWps,
  requestCanvasExport,
  type CanvasExportResultDetail,
} from "../canvas/host-actions";
import {
  consumePendingRevealFileLine,
  LAWMIND_REVEAL_FILE_LINE_EVENT,
  offsetForLine,
  type RevealFileLineDetail,
} from "../lawmind-workspace-file-open";

export type FileWorkbenchEditorPaneProps = {
  tabs: OpenFileTab[];
  activeTabId: string | null;
  setActiveTabId: Dispatch<SetStateAction<string | null>>;
  activeTab: OpenFileTab | null | undefined;
  activeDirty: boolean;
  busy: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  onSendContractForReview?: (payload: { root: RootKey; relPath: string }) => void;
  imagePreview: { root: RootKey; relPath: string; name: string; dataUrl: string } | null;
  setImagePreview: Dispatch<
    SetStateAction<{ root: RootKey; relPath: string; name: string; dataUrl: string } | null>
  >;
  officeBlock: { root: RootKey; relPath: string; name: string; mode?: "office" | "binary" } | null;
  setOfficeBlock: Dispatch<
    SetStateAction<{ root: RootKey; relPath: string; name: string; mode?: "office" | "binary" } | null>
  >;
  setError: Dispatch<SetStateAction<string | null>>;
  closeTab: (id: string) => void;
  updateActiveContent: (content: string) => void;
  saveActive: () => void | Promise<void>;
  saveActiveAs: () => void | Promise<void>;
  doShowInFolder: (root: RootKey, relPath: string) => void | Promise<void>;
  apiBase?: string;
  projectDir?: string | null;
};

export function FileWorkbenchEditorPane({
  tabs,
  activeTabId,
  setActiveTabId,
  activeTab,
  activeDirty,
  busy,
  onAddToChatContext,
  onSendContractForReview,
  imagePreview,
  setImagePreview,
  officeBlock,
  setOfficeBlock,
  setError,
  closeTab,
  updateActiveContent,
  saveActive,
  saveActiveAs,
  doShowInFolder,
  apiBase = "",
  projectDir = null,
}: FileWorkbenchEditorPaneProps) {
  const canvasFile = Boolean(activeTab && /\.canvas\.tsx$/i.test(activeTab.path));
  const [canvasSource, setCanvasSource] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const appliedReveal = useRef("");
  const [lineReveal, setLineReveal] = useState<RevealFileLineDetail | null>(null);
  const canvasKind = useLawmindCanvasKind();
  const canvasPreview = canvasFile && !canvasSource;
  const canvasBg = canvasKind === "dark" ? "#181818" : "#FCFCFC";
  const canvasFg = canvasKind === "dark" ? "#E4E4E4" : "#141414";
  const canvasLine = canvasKind === "dark" ? "#E4E4E41F" : "#1414141F";
  const canvasTabId = activeTab?.id;
  const [canvasTabSeen, setCanvasTabSeen] = useState(canvasTabId);
  const [canvasExportNote, setCanvasExportNote] = useState<string | null>(null);
  if (canvasTabId !== canvasTabSeen) {
    setCanvasTabSeen(canvasTabId);
    setCanvasSource(false);
    setCanvasExportNote(null);
  }
  useEffect(() => {
    const apply = (detail: RevealFileLineDetail | null) => {
      if (detail?.line) {
        setLineReveal(detail);
      }
    };
    apply(consumePendingRevealFileLine());
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<RevealFileLineDetail>).detail ?? null;
      consumePendingRevealFileLine();
      apply(detail);
    };
    window.addEventListener(LAWMIND_REVEAL_FILE_LINE_EVENT, onReveal);
    return () => window.removeEventListener(LAWMIND_REVEAL_FILE_LINE_EVENT, onReveal);
  }, []);

  useEffect(() => {
    if (!lineReveal || !activeTab) {
      return;
    }
    if (activeTab.root !== lineReveal.root || activeTab.path !== lineReveal.relPath) {
      return;
    }
    const revealKey = `${lineReveal.root}|${lineReveal.relPath}|${lineReveal.line}|${lineReveal.column}`;
    if (canvasFile && !canvasSource) {
      if (appliedReveal.current.startsWith(revealKey)) {
        return;
      }
      setCanvasSource(true);
      return;
    }
    const area = sourceRef.current;
    if (!area || appliedReveal.current === revealKey) {
      return;
    }
    appliedReveal.current = revealKey;
    const range = offsetForLine(activeTab.content, lineReveal.line, lineReveal.column);
    area.focus();
    area.setSelectionRange(range.start, range.end);
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 20;
    area.scrollTop = Math.max(0, (lineReveal.line - 3) * lineHeight);
  }, [activeTab, canvasFile, canvasSource, lineReveal]);

  useEffect(() => {
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<CanvasExportResultDetail>).detail;
      if (!detail || !activeTab || detail.root !== activeTab.root || detail.path !== activeTab.path) {
        return;
      }
      setCanvasExportNote(detail.ok ? "已导出网页" : detail.message);
      if (detail.ok && detail.htmlPath) {
        void doShowInFolder(activeTab.root, detail.htmlPath);
      }
    };
    window.addEventListener(LAWMIND_CANVAS_EXPORT_RESULT_EVENT, onResult);
    return () => window.removeEventListener(LAWMIND_CANVAS_EXPORT_RESULT_EVENT, onResult);
  }, [activeTab, doShowInFolder]);
  return (
    <section className="lm-files-editor" onClick={(e) => e.stopPropagation()}>
      {canvasPreview || tabs.length === 0 ? null : (
      <div className="lm-file-tabs" role="tablist" aria-label="打开的文件">
        {tabs.map((tab) => {
          const dirty = tab.content !== tab.savedContent;
          const selected = activeTabId === tab.id;
          const activate = () => {
            setOfficeBlock(null);
            setImagePreview(null);
            setActiveTabId(tab.id);
          };
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={selected}
              aria-controls="lm-file-editor-panel"
              tabIndex={selected ? 0 : -1}
              className={`lm-file-tab ${selected ? "active" : ""}`}
              title={`${tab.root}:${tab.path}`}
              onClick={activate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }}
            >
              <span className="lm-fs-icon">{getFileIcon(tab.name, "file")}</span>
              <span>{tab.name}{dirty ? " ●" : ""}</span>
              <button
                type="button"
                className="lm-file-tab-close"
                aria-label={`关闭 ${tab.name}`}
                onMouseDown={(e) => { e.stopPropagation(); }}
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >×</button>
            </div>
          );
        })}
      </div>
      )}

      {activeTab ? (
        <div
          className="lm-editor-pane"
          role="tabpanel"
          id="lm-file-editor-panel"
          aria-label={activeTab.name}
          style={
            canvasPreview
              ? {
                  background: canvasBg,
                  color: canvasFg,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  flex: "1 1 auto",
                }
              : undefined
          }
        >
          {canvasPreview ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                height: 28,
                padding: "0 12px",
                flexShrink: 0,
                borderBottom: `1px solid ${canvasLine}`,
                fontSize: 12,
                lineHeight: "16px",
              }}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {lawyerCanvasTitle(activeTab.name)}
                {canvasExportNote ? ` · ${canvasExportNote}` : ""}
              </span>
              <span style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => requestCanvasExport(activeTab.root, activeTab.path)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    opacity: 0.74,
                    font: "inherit",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  导出网页
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasSource(true)}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "inherit",
                    opacity: 0.74,
                    font: "inherit",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  源码
                </button>
              </span>
            </div>
          ) : null}
          {canvasPreview ? null : (
          <div className="lm-editor-header">
            <div className="lm-editor-breadcrumb">
              <span className="lm-editor-root-badge">{activeTab.root}</span>
              <span className="lm-editor-path">{activeTab.path}</span>
            </div>
            <div className="lm-compose-actions">
              {activeDirty && <span className="lm-dot lm-dot-warn">未保存</span>}
              {onAddToChatContext && activeTab ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => onAddToChatContext({ root: activeTab.root, relPath: activeTab.path, kind: "file" })}
                >
                  加入对话引用
                </button>
              ) : null}
              {onSendContractForReview &&
              activeTab &&
              isContractReviewCandidatePath(activeTab.path) ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-accent lm-btn-sm"
                  data-testid="lm-editor-send-contract-review"
                  onClick={() =>
                    onSendContractForReview({ root: activeTab.root, relPath: activeTab.path })
                  }
                >
                  送审本合同
                </button>
              ) : null}
              {canvasFile ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => setCanvasSource((value) => !value)}
                >
                  {canvasSource ? "画布" : "源码"}
                </button>
              ) : null}
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy || !activeTab}
                title={!activeDirty ? "无未保存修改时不会写入" : "保存到当前文件（⌘S）"}
                onClick={() => void saveActive()}
              >
                保存
              </button>
              <button type="button" className="lm-btn lm-btn-secondary lm-btn-sm" disabled={busy || !activeTab} onClick={() => void saveActiveAs()}>另存为…</button>
            </div>
          </div>
          )}
          {canvasPreview ? (
            <CanvasFileView root={activeTab.root} path={activeTab.path} source={activeTab.content} />
          ) : (
            <textarea
              ref={sourceRef}
              className="lm-editor-textarea"
              value={activeTab.content}
              onChange={(e) => updateActiveContent(e.target.value)}
              spellCheck={false}
            />
          )}
          {canvasPreview ? null : (
          <div className="lm-editor-statusbar">
            {activeTab.name} · {activeTab.content.split("\n").length} 行 · {activeTab.content.length} 字符
          </div>
          )}
        </div>
      ) : imagePreview ? (
        <div className="lm-editor-pane lm-image-preview-pane">
          <div className="lm-editor-header">
            <div className="lm-editor-breadcrumb">
              <span className="lm-editor-root-badge">{imagePreview.root}</span>
              <span className="lm-editor-path">{imagePreview.relPath || "(根)"}</span>
            </div>
            <div className="lm-editor-actions">
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                onClick={() => void doShowInFolder(imagePreview.root, imagePreview.relPath)}
              >
                在访达中显示
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  const r = await window.lawmindDesktop?.openWithSystem({
                    root: imagePreview.root,
                    path: imagePreview.relPath,
                  });
                  if (r && !r.ok) {
                    setError(r.error ?? "无法用系统应用打开该文件。");
                  }
                }}
              >
                用本机应用打开
              </button>
              {onAddToChatContext ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() =>
                    onAddToChatContext({
                      root: imagePreview.root,
                      relPath: imagePreview.relPath,
                      kind: "file",
                    })
                  }
                >
                  在对话中引用
                </button>
              ) : null}
            </div>
          </div>
          <div className="lm-image-preview-body">
            <img className="lm-image-preview-img" src={imagePreview.dataUrl} alt={imagePreview.name} />
            <p className="lm-meta lm-image-preview-caption">{imagePreview.name}</p>
          </div>
        </div>
      ) : officeBlock && /\.docx$/i.test(officeBlock.relPath) ? (
        <div className="lm-editor-pane lm-office-doc-pane lm-word-surface-pane">
          <LawmindWordRevisionSurface
            apiBase={apiBase}
            projectDir={projectDir}
            root={officeBlock.root}
            relPath={officeBlock.relPath}
            fileName={officeBlock.name}
            busy={busy}
            onRevealSource={() => void doShowInFolder(officeBlock.root, officeBlock.relPath)}
            onOpenWithSystem={() => {
              setError(null);
              void openDeliverableInWps(officeBlock.relPath, officeBlock.root).then((r) => {
                if (!r.ok) {
                  setError(r.error ?? "无法用 WPS 打开该文件。");
                }
              });
            }}
          />
        </div>
      ) : officeBlock ? (
        <div className="lm-editor-pane lm-office-doc-pane">
          <div className="lm-editor-header">
            <div className="lm-editor-breadcrumb">
              <span className="lm-editor-root-badge">{officeBlock.root}</span>
              <span className="lm-editor-path">{officeBlock.relPath || "(根)"}</span>
            </div>
          </div>
          <div className="lm-office-doc-body">
            <p className="lm-office-doc-title">{officeBlock.name}</p>
            <p className="lm-office-doc-copy">
              {officeBlock.mode === "binary"
                ? "该文件为二进制格式，无法在此纯文本编辑器中打开。可用本机应用查看，或在访达中打开。"
                : "本页为纯文本材料编辑器，不支持 Word/Excel/PowerPoint/PDF 的版式与表格预览。请用本机已安装的 Office 或 WPS 等打开编辑。"}
            </p>
            <div className="lm-office-doc-actions">
              <button
                type="button"
                className="lm-btn lm-btn-sm"
                disabled={busy}
                onClick={async () => {
                  setError(null);
                  const r = await window.lawmindDesktop?.openWithSystem({
                    root: officeBlock.root,
                    path: officeBlock.relPath,
                  });
                  if (r && !r.ok) {
                    setError(r.error ?? "无法用系统应用打开该文件。");
                  }
                }}
              >
                用本机应用打开
              </button>
              <button
                type="button"
                className="lm-btn lm-btn-secondary lm-btn-sm"
                onClick={() => void doShowInFolder(officeBlock.root, officeBlock.relPath)}
              >
                在访达中显示
              </button>
              {onAddToChatContext ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-ghost lm-btn-sm"
                  onClick={() => onAddToChatContext({ root: officeBlock.root, relPath: officeBlock.relPath, kind: "file" })}
                >
                  在对话中引用
                </button>
              ) : null}
              {onSendContractForReview && isContractReviewCandidatePath(officeBlock.relPath) ? (
                <button
                  type="button"
                  className="lm-btn lm-btn-accent lm-btn-sm"
                  data-testid="lm-editor-send-contract-review"
                  onClick={() =>
                    onSendContractForReview({
                      root: officeBlock.root,
                      relPath: officeBlock.relPath,
                    })
                  }
                >
                  送审本合同
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="lm-editor-empty">
          <div className="lm-messages-empty-icon">📂</div>
          <div className="lm-messages-empty-title">选择文件开始编辑</div>
          <div className="lm-messages-empty-hint">点文件或 ⌘P。</div>
        </div>
      )}
    </section>
  );
}
