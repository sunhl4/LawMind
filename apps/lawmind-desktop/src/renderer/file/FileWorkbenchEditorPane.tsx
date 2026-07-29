import type { Dispatch, SetStateAction } from "react";
import { type RootKey, type OpenFileTab } from "./file-workbench-types";
import { getFileIcon } from "./file-workbench-fs";

export type FileWorkbenchEditorPaneProps = {
  tabs: OpenFileTab[];
  activeTabId: string | null;
  setActiveTabId: Dispatch<SetStateAction<string | null>>;
  activeTab: OpenFileTab | null | undefined;
  activeDirty: boolean;
  busy: boolean;
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
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
};

export function FileWorkbenchEditorPane({
  tabs,
  activeTabId,
  setActiveTabId,
  activeTab,
  activeDirty,
  busy,
  onAddToChatContext,
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
}: FileWorkbenchEditorPaneProps) {
  return (
    <section className="lm-files-editor" onClick={(e) => e.stopPropagation()}>
      <div className="lm-file-tabs">
        {tabs.map((tab) => {
          const dirty = tab.content !== tab.savedContent;
          return (
            <button
              key={tab.id}
              type="button"
              className={`lm-file-tab ${activeTabId === tab.id ? "active" : ""}`}
              title={`${tab.root}:${tab.path}`}
              onClick={() => {
                setOfficeBlock(null);
                setImagePreview(null);
                setActiveTabId(tab.id);
              }}
            >
              <span className="lm-fs-icon">{getFileIcon(tab.name, "file")}</span>
              <span>{tab.name}{dirty ? " ●" : ""}</span>
              <span
                className="lm-file-tab-close"
                role="button"
                tabIndex={0}
                onMouseDown={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                onKeyDown={(e) => { if (e.key === "Enter") {closeTab(tab.id);} }}
              >×</span>
            </button>
          );
        })}
      </div>

      {activeTab ? (
        <div className="lm-editor-pane">
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
          <textarea
            className="lm-editor-textarea"
            value={activeTab.content}
            onChange={(e) => updateActiveContent(e.target.value)}
            spellCheck={false}
          />
          <div className="lm-editor-statusbar">
            {activeTab.name} · {activeTab.content.split("\n").length} 行 · {activeTab.content.length} 字符
          </div>
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
            </div>
          </div>
        </div>
      ) : (
        <div className="lm-editor-empty">
          <div className="lm-messages-empty-icon">📂</div>
          <div className="lm-messages-empty-title">选择文件开始编辑</div>
          <div className="lm-messages-empty-hint">在左栏资源树中点击文件，或按 ⌘P 快速搜索。图片可预览；Word 文档请用系统应用打开。</div>
        </div>
      )}
    </section>
  );
}
