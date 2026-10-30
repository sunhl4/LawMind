/**
 * 中栏当前显示的是哪份文件（不是草稿台、也不是案卷）。
 *
 * 拖出中栏时要把「正在看的那一份」带到新窗口；文件工作台的打开标签本身是
 * 组件内 state，跨窗口拿不到，所以在打开/切换标签时记一个模块级指针。
 */

import type { WorkspaceFileRoot } from "./lawmind-workspace-file-open";

export type MiddleFileSurface = {
  root: WorkspaceFileRoot;
  relPath: string;
};

let currentFile: MiddleFileSurface | null = null;

export function setCurrentMiddleFile(surface: MiddleFileSurface | null): void {
  const relPath = surface?.relPath?.trim() ?? "";
  currentFile = surface && relPath ? { root: surface.root, relPath } : null;
}

export function currentMiddleFile(): MiddleFileSurface | null {
  return currentFile;
}
