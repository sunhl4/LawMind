import type { PointerEvent as ReactPointerEvent } from "react";
import { ellipsisText } from "../display-ids";
import { LM_PANE_MAX_WIDTH_PX, LM_PANE_MIN_WIDTH_PX } from "../lawmind-panel-layout";

export type MatterOverviewRow = {
  matterId: string;
  displayName?: string;
};

type Props = {
  workbenchListWidth: number;
  onMatterListResize: (e: ReactPointerEvent) => void;
  loadingList: boolean;
  listError: string | null;
  overviews: MatterOverviewRow[];
  internalSelectedId: string | null;
  onSelectMatter: (matterId: string) => void;
  onRefreshList: () => void;
  onCreateMatter: () => void;
  onMatterContextMenu: (e: React.MouseEvent, matterId: string) => void;
  canMatterContextMenu: boolean;
};

export function MatterWorkbenchListPane(props: Props) {
  const {
    workbenchListWidth,
    onMatterListResize,
    loadingList,
    listError,
    overviews,
    internalSelectedId,
    onSelectMatter,
    onRefreshList,
    onCreateMatter,
    onMatterContextMenu,
    canMatterContextMenu,
  } = props;

  return (
    <>
      <div className="lm-workbench-list" style={{ width: workbenchListWidth, flexShrink: 0 }}>
        <div className="lm-workbench-list-header">
          <h2>案件</h2>
          <div className="lm-workbench-list-actions">
            <button type="button" className="lm-btn lm-btn-small" onClick={onCreateMatter}>
              新建案件
            </button>
            <button
              type="button"
              className="lm-btn lm-btn-secondary lm-btn-small"
              onClick={onRefreshList}
            >
              刷新
            </button>
          </div>
        </div>
        {loadingList && <div className="lm-meta">加载中…</div>}
        {listError ? (
          <div className="lm-callout lm-callout-danger" role="alert">
            <p className="lm-callout-body">{listError}</p>
          </div>
        ) : null}
        {!loadingList && overviews.length === 0 && (
          <div className="lm-meta lm-workbench-empty">暂无案件</div>
        )}
        <ul className="lm-workbench-matter-list">
          {overviews.map((o) => (
            <li key={o.matterId}>
              <button
                type="button"
                className={`lm-matter-row ${internalSelectedId === o.matterId ? "active" : ""}`}
                title={`案件编号：${o.matterId}。右键可关联对话或打开文件夹。`}
                onClick={() => onSelectMatter(o.matterId)}
                onContextMenu={(e) => {
                  if (!canMatterContextMenu) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  onMatterContextMenu(e, o.matterId);
                }}
              >
                <span className="lm-matter-id">
                  {ellipsisText(o.displayName?.trim() || o.matterId, 46)}
                </span>
                {o.displayName?.trim() && o.displayName.trim() !== o.matterId ? (
                  <span className="lm-matter-meta">{ellipsisText(o.matterId, 36)}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div
        className="lm-split-handle lm-split-handle-vertical"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整案件列表宽度"
        title="拖动调整列表宽度"
        onPointerDown={onMatterListResize}
      />
    </>
  );
}

export const MATTER_LIST_PANE_LIMITS = {
  min: LM_PANE_MIN_WIDTH_PX,
  max: LM_PANE_MAX_WIDTH_PX,
};
