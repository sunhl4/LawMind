import type { ReactNode } from "react";

/** 工作区 / 本机项目夹：两个「真」根，文件树与右键操作只认它们。 */
export type RootKey = "workspace" | "project";

/**
 * 可读写的文件根。
 *
 * `file:<id>` 是律师让助手找到、工作区之外的文件。**权限与工作区相同**
 * （可读可写，Cursor 的手感），由主进程按次登记；它不进文件树，
 * 因为树的语义是「工作区内容」。
 */
export type AnyFileRoot = RootKey | `file:${string}`;

export type FsEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
  mtimeMs: number;
};

/** Middle-column preview kind. Binary kinds keep content empty; image may set dataUrl. */
export type FilePreviewKind =
  | "text"
  | "word"
  | "image"
  | "pdf"
  | "xlsx"
  | "pptx"
  | "media"
  | "eml"
  | "zip"
  | "doc"
  | "fallback";

export type OpenFileTab = {
  id: string;
  /** 可读写根：外部 `file:<id>` 与工作区同权限，所以也能进标签页。 */
  root: AnyFileRoot;
  path: string;
  name: string;
  kind: FilePreviewKind;
  /** Text tabs only — binary tabs leave both empty. */
  content: string;
  savedContent: string;
  mtimeMs: number;
  /** Image preview data URL when kind === "image". */
  dataUrl?: string;
  /** Fallback panel copy when kind === "fallback" (or until a richer kind ships). */
  fallbackMode?: "office" | "binary";
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
  /** 覆盖默认 placeholder（如新建案件用「案件名…」） */
  placeholder?: string;
  onDone: (name: string) => Promise<void>;
};

export type FsClip = {
  op: "copy" | "cut";
  root: RootKey;
  relPaths: string[];
};

export type FilePortalHosts = {
  explorer: HTMLElement | null;
  /**
   * When set with `explorer`, the workbench splits the rail:
   * `explorer` = 工作区（本机文件夹），`explorerCases` = 案件材料。
   * Omit to keep both sections in a single `explorer` host.
   */
  explorerCases?: HTMLElement | null;
  /**
   * `work`：侧栏只挂本机文件夹。
   * 缺省且同时有 explorerCases 时，工作区与案件材料分成两棵。
   */
  explorerSections?: "work" | "split";
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
  onRequestDeleteMatter: (matterId: string, label: string) => void;
  onSetCaseSubdirRole?: (matterId: string, role: "matter" | "folder") => void | Promise<void>;
  /**
   * 在「案件材料」上右键「新建案件」：就地建 `cases/<案件名>/` 文件夹（不跳转、不开建案弹窗）。
   * 未提供时回退为普通新建文件夹。
   */
  onNewMatterFolder?: () => void;
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
  /** 选择本机文件夹作为「工作区」浏览根（project root） */
  onPickProject?: () => void | Promise<void>;
  /** 将路径加入对话/议题引用（发送时把路径说明一并给模型） */
  onAddToChatContext?: (payload: { root: RootKey; relPath: string; kind: "file" | "directory" }) => void;
  /** 在本机文件夹的某一级上新建对话。相对路径挂到这场对话上。 */
  onNewChatInFolder?: (folderRel: string) => void | Promise<void>;
  /** 右键目录：用这个绝对路径新建一场工作区，不改已有对话。 */
  onCreateChatWorkspace?: (workDir: string) => void | Promise<void>;
  /** 右键「引用」菜单文案；默认「在对话中引用」 */
  addToContextLabel?: string;
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
  /** 左栏当前案件。有值时「本案材料」只列这一案的目录。 */
  explorerMatterId?: string | null;
  /** 会议室默认展开材料，便于拖入议题。 */
  materialsDefaultOpen?: boolean;
};

export type FileWorkbenchProps = Props;
