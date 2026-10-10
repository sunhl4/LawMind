import { useEffect, useRef, useState, type Dispatch, SetStateAction } from "react";
import { type RootKey, type OpenFileTab } from "./file-workbench-types";
import { fileTabAddress, wpsTabLabel } from "./file-tab-layout";
import { FileTabHoverCard, fileTabHoverTarget, useFileTabHover } from "./file-tab-hover";
import { FileTypeMark } from "./file-type-mark";
import { lawyerCanvasTitle } from "../lawmind-explorer-lawyer-view";
import { CanvasFileView } from "../canvas/CanvasFileView";
import { useLawmindCanvasKind } from "../canvas/theme";
import {
  LAWMIND_CANVAS_EXPORT_RESULT_EVENT,
  requestCanvasExport,
  type CanvasExportResultDetail,
} from "../canvas/host-actions";
import {
  consumePendingRevealFileLine,
  LAWMIND_REVEAL_FILE_LINE_EVENT,
  offsetForLine,
  type RevealFileLineDetail,
} from "../lawmind-workspace-file-open";
import {
  FallbackPreviewPanel,
  ImagePreviewPanel,
  WordPreviewPanel,
  keepsMountedWhileInactive,
  type PreviewHeaderActions,
} from "./preview-registry";
import { DocFileView } from "./DocFileView";
import { EmlFileView } from "./EmlFileView";
import { MediaFileView } from "./MediaFileView";
import { PdfFileView } from "./PdfFileView";
import { XlsxFileView } from "./XlsxFileView";
import { ZipFileView } from "./ZipFileView";

export type FileWorkbenchEditorPaneProps = {
  tabs: OpenFileTab[];
  activeTabId: string | null;
  setActiveTabId: Dispatch<SetStateAction<string | null>>;
  activeTab: OpenFileTab | null | undefined;
  activeDirty: boolean;
  busy: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  closeTab: (id: string) => void;
  updateActiveContent: (content: string) => void;
  saveActive: () => void | Promise<void>;
  saveActiveAs: () => void | Promise<void>;
  doShowInFolder: (root: RootKey, relPath: string) => void | Promise<void>;
  apiBase?: string;
  workspaceDir?: string;
  projectDir?: string | null;
};

function previewActionsFor(
  tab: OpenFileTab,
  props: Pick<
    FileWorkbenchEditorPaneProps,
    "busy" | "onAddToChatContext" | "doShowInFolder" | "setError"
  >,
): PreviewHeaderActions {
  return {
    busy: props.busy,
    onAddToChatContext: props.onAddToChatContext,
    onRevealSource: () => void props.doShowInFolder(tab.root, tab.path),
    onOpenWithSystem: () => {
      props.setError(null);
      void window.lawmindDesktop?.openWithSystem({ root: tab.root, path: tab.path }).then((r) => {
        if (r && !r.ok) {
          props.setError(r.error ?? "无法用系统应用打开该文件。");
        }
      });
    },
  };
}

export function FileWorkbenchEditorPane({
  tabs,
  activeTabId,
  setActiveTabId,
  activeTab,
  activeDirty,
  busy,
  onAddToChatContext,
  setError,
  closeTab,
  updateActiveContent,
  saveActive,
  saveActiveAs,
  doShowInFolder,
  apiBase = "",
  workspaceDir = "",
  projectDir = null,
}: FileWorkbenchEditorPaneProps) {
  const canvasFile = Boolean(activeTab && activeTab.kind === "text" && /\.canvas\.tsx$/i.test(activeTab.path));
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
    if (!lineReveal || !activeTab || activeTab.kind !== "text") {
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

  const mountedTabs = tabs.filter((tab) => keepsMountedWhileInactive(tab.kind));
  const showTabStrip = tabs.length > 0 && !canvasPreview;
  const tabHover = useFileTabHover();
  const hoveredTab = fileTabHoverTarget(tabs, tabHover.hover);

  return (
    <section className="lm-files-editor" onClick={(e) => e.stopPropagation()}>
      {showTabStrip ? (
        <div className="lm-file-tabs" role="tablist" aria-label="打开的文件">
          {tabs.map((tab) => {
            const dirty = tab.kind === "text" && tab.content !== tab.savedContent;
            const selected = activeTabId === tab.id;
            const activate = () => {
              setActiveTabId(tab.id);
            };
            return (
              <div
                key={tab.id}
                id={`lm-file-tab-${tab.id}`}
                role="tab"
                aria-selected={selected}
                aria-controls="lm-file-editor-panel"
                tabIndex={selected ? 0 : -1}
                className={`lm-file-tab${selected ? " active" : ""}${dirty ? " dirty" : ""}`}
                aria-label={dirty ? `${tab.name}，未保存` : tab.name}
                onMouseEnter={(event) => tabHover.queueShow(tab.id, event.currentTarget)}
                onMouseLeave={tabHover.queueHide}
                onClick={activate}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                  }
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) {
                    return;
                  }
                  e.preventDefault();
                  closeTab(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    activate();
                    return;
                  }
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
                    return;
                  }
                  e.preventDefault();
                  const index = tabs.findIndex((item) => item.id === tab.id);
                  const next = tabs[index + (e.key === "ArrowRight" ? 1 : -1)];
                  if (!next) {
                    return;
                  }
                  setActiveTabId(next.id);
                  queueMicrotask(() => {
                    document.getElementById(`lm-file-tab-${next.id}`)?.focus();
                  });
                }}
              >
                <FileTypeMark name={tab.name} />
                <span className="lm-file-tab-label">{wpsTabLabel(tab.name)}</span>
                <button
                  type="button"
                  className="lm-file-tab-close"
                  aria-label={`关闭 ${tab.name}`}
                  title={dirty ? "关闭（未保存）" : "关闭"}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <svg className="lm-file-tab-x" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <path
                      d="M3.15 3.15l5.7 5.7M8.85 3.15l-5.7 5.7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.35"
                      strokeLinecap="round"
                    />
                  </svg>
                  {dirty ? <span className="lm-file-tab-dirty" aria-hidden="true" /> : null}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {hoveredTab && tabHover.hover ? (
        <FileTabHoverCard
          hover={tabHover.hover}
          name={hoveredTab.name}
          address={fileTabAddress(hoveredTab.root, hoveredTab.path, workspaceDir, projectDir)}
          canAdd={Boolean(onAddToChatContext)}
          onPointerEnter={tabHover.cancelHide}
          onPointerLeave={tabHover.queueHide}
          onAdd={() => {
            onAddToChatContext?.({ root: hoveredTab.root, relPath: hoveredTab.path, kind: "file" });
            tabHover.dismiss();
          }}
        />
      ) : null}

      {mountedTabs.map((tab) => {
        const active = tab.id === activeTabId;
        const actions = previewActionsFor(tab, {
          busy,
          onAddToChatContext,
          doShowInFolder,
          setError,
        });
        return (
          <div
            key={tab.id}
            role={active ? "tabpanel" : undefined}
            id={active ? "lm-file-editor-panel" : undefined}
            aria-label={active ? tab.name : undefined}
            aria-hidden={!active}
            className="lm-preview-host"
            hidden={!active}
            style={active ? undefined : { display: "none" }}
            data-preview-kind={tab.kind}
            data-testid={active ? `lm-preview-active-${tab.kind}` : undefined}
          >
            {tab.kind === "word" ? (
              <WordPreviewPanel
                tab={tab}
                apiBase={apiBase}
                projectDir={projectDir}
                busy={busy}
                onRevealSource={actions.onRevealSource}
                onError={(message) => setError(message)}
              />
            ) : tab.kind === "image" ? (
              <ImagePreviewPanel tab={tab} actions={actions} />
            ) : tab.kind === "pdf" ? (
              <PdfFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : tab.kind === "xlsx" ? (
              <XlsxFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : tab.kind === "media" ? (
              <MediaFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : tab.kind === "eml" ? (
              <EmlFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : tab.kind === "zip" ? (
              <ZipFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : tab.kind === "doc" ? (
              <DocFileView tab={tab} apiBase={apiBase} actions={actions} />
            ) : (
              <FallbackPreviewPanel tab={tab} actions={actions} />
            )}
          </div>
        );
      })}

      {activeTab && activeTab.kind === "text" ? (
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
                {onAddToChatContext ? (
                  <button
                    type="button"
                    className="lm-btn lm-btn-ghost lm-btn-sm"
                    onClick={() =>
                      onAddToChatContext({ root: activeTab.root, relPath: activeTab.path, kind: "file" })
                    }
                  >
                    加入对话引用
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
                <button
                  type="button"
                  className="lm-btn lm-btn-secondary lm-btn-sm"
                  disabled={busy || !activeTab}
                  onClick={() => void saveActiveAs()}
                >
                  另存为…
                </button>
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
      ) : null}

      {activeTab && activeTab.kind === "fallback" ? (
        <div
          role="tabpanel"
          id="lm-file-editor-panel"
          aria-label={activeTab.name}
          data-testid={`lm-preview-active-${activeTab.kind}`}
        >
          <FallbackPreviewPanel
            tab={activeTab}
            actions={previewActionsFor(activeTab, {
              busy,
              onAddToChatContext,
              doShowInFolder,
              setError,
            })}
          />
        </div>
      ) : null}

      {!activeTab && tabs.length === 0 ? (
        <div className="lm-editor-empty">
          <div className="lm-messages-empty-icon">📂</div>
          <div className="lm-messages-empty-title">选择文件开始编辑</div>
          <div className="lm-messages-empty-hint">点文件或 ⌘P。</div>
        </div>
      ) : null}
    </section>
  );
}
