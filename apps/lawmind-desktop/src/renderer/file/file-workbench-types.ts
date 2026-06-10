import type { ReactNode } from "react";

export type RootKey = "workspace" | "project";

export type FsEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mtimeMs: number;
};

export type OpenFileTab = {
  id: string;
  root: RootKey;
  path: string;
  name: string;
  content: string;
  savedContent: string;
  mtimeMs: number;
};

export type IndexedFile = { root: RootKey; path: string; name: string };

export type ContextMenu = {
  x: number;
  y: number;
  root: RootKey;
  path: string;
  kind: "file" | "directory";
  isRoot: boolean;
};

export type ConfirmDialog =
  | { kind: "simple"; message: string; onConfirm: () => void }
  | { kind: "danger"; title: string; body: string; confirmLabel: string; onConfirm: () => void };

export type InlineInput = {
  root: RootKey;
  parentDir: string;
  kind: "file" | "folder";
  initialValue: string;
  onDone: (name: string) => Promise<void>;
};

export type FsClip = {
  op: "copy" | "cut";
  root: RootKey;
  relPaths: string[];
};

export type FilePortalHosts = {
  explorer: HTMLElement | null;
  /** When set, drag handle lives between file tree and the next column (legacy three-column rail). */
  split?: HTMLElement | null;
  /** 主区为案件工作台时可缺省，仅保留侧栏材料树。 */
  editor?: HTMLElement | null;
  /** Rail = fixed-width tree column; embedded = stretch inside sidebar. Default: rail if split is set, else embedded. */
  explorerLayout?: "rail" | "embedded";
};

export type FileWorkbenchCasesNodeActions = {
  apiBase: string;
  workspaceDir?: string | null;
  matterLabelById?: Record<string, string>;
  onOpenMatterCockpit: (matterId: string) => void;
  onLinkMatterToChat?: (matterId: string) => void;
  onRequestRenameDisplayName: (matterId: string, initialTitle: string) => void;
  onRequestDeleteMatter: (matterId: string, label: string) => void;
  onSetCaseSubdirRole?: (matterId: string, role: "matter" | "folder") => void | Promise<void>;
  /** 在「案件目录」或磁盘路径为 `cases` 的目录上右键：新建/导入/刷新（与顶部工具条案件操作一致） */
  onNewMatter?: () => void;
  onImportMatters?: () => void;
  onRefreshMatters?: () => void;
  importMattersBusy?: boolean;
  /** 桌面环境是否支持文件选择导入 */
  canImportMatters?: boolean;
};

export type Props = {
  workspaceDir: string;
  projectDir: string | null;
  canUseFilesystemBridge: boolean;
  /** 将路径加入对话引用（会切换到对话；发送时把路径说明一并给模型） */
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  /** When set, 资源管理器 / 分割条 / 编辑器分别挂到这些节点（用于侧栏资源区 + 主区对话等布局） */
  portalHosts?: FilePortalHosts | null;
  /** 工作区资源区顶部工具条（如未关联、案件工作台等） */
  workspaceExplorerToolbar?: ReactNode;
  /** `cases/<id>/` 下文件/目录的右键扩展（案件工作台、角色等） */
  casesNodeActions?: FileWorkbenchCasesNodeActions | null;
  /** 右键「加入案件」时可选目标（通常取自 records 案件列表，不含「未关联」） */
  mattersPickList?: Array<{ id: string; label: string }> | null;
  /** 与案件列表联动（如删除/新建案件后递增）：刷新工作区与 cases 树缓存，避免出现陈旧节点 */
  workspaceTreeRefreshKey?: number;
};

export type FileWorkbenchProps = Props;
