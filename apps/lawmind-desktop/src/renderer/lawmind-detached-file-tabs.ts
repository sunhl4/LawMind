/**
 * 文件标签拖出到独立窗后的「回程票」。
 *
 * 标签拖出时主窗口会把它关掉（避免两处同时改同一份文件），但关掉独立窗后
 * 标签得回到主窗口，否则用户会觉得文件被吞了。这里只记 key → 文件位置；
 * 独立窗关闭事件由主窗口的 pane 控制器消费，真正打开仍走 `requestOpenWorkspaceFile`。
 *
 * 纯内存：主窗口重载后丢失是可接受的 —— 那时独立窗还开着，用户仍可手动打开文件。
 */

import type { WorkspaceFileRoot } from "./lawmind-workspace-file-open";

export type DetachedFileTabLocation = {
  root: WorkspaceFileRoot;
  relPath: string;
};

const detachedFileTabs = new Map<string, DetachedFileTabLocation>();

export function rememberDetachedFileTab(
  key: string,
  location: DetachedFileTabLocation,
): void {
  const trimmedKey = key.trim();
  const relPath = location.relPath.trim();
  if (!trimmedKey || !relPath) {
    return;
  }
  detachedFileTabs.set(trimmedKey, { root: location.root, relPath });
}

/** 取出并删除；只有真正关闭对应独立窗时才调用一次。 */
export function takeDetachedFileTab(key: string): DetachedFileTabLocation | null {
  const trimmedKey = key.trim();
  const found = detachedFileTabs.get(trimmedKey);
  if (!found) {
    return null;
  }
  detachedFileTabs.delete(trimmedKey);
  return found;
}
