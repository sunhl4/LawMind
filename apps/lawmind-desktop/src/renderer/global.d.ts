/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAWMIND_DOCS_BASE?: string;
  readonly VITE_LAWMIND_GITHUB_BLOB_BASE?: string;
  readonly VITE_LAWMIND_DOWNLOAD_PAGE_URL?: string;
  readonly VITE_LAWMIND_INTERNAL_EXPERIMENT_UI?: string;
}

declare global {
  interface Window {
    lawmindDesktop?: {
      getConfig: () => Promise<{
        apiBase: string;
        apiAuthToken?: string;
        /**
         * 端口漂移记录（非空 = 持久化端口没绑上）。
         *
         * 漂移会静默破坏 Word 侧载清单（清单里的端口是钉死的），所以必须在体检面板
         * 里可见 —— 见 `local-server.mjs` 的 `loopbackPortDrift` 与 `main.mjs` 的单实例锁。
         */
        loopbackPortDrift?: {
          requestedPort: number;
          actualPort: number;
          occupant: "another-lawmind" | "foreign" | "unknown";
        } | null;
        /** Word / WPS 加载项是否已指到当前这次 LawMind。不含端口号。 */
        addinHosts?: {
          word: "connected" | "reopen" | "missing" | "another-copy";
          wps: "connected" | "reopen" | "missing" | "another-copy";
        };
        workspaceDir: string;
        projectDir: string | null;
        envFilePath: string;
        lawMindRoot: string;
        configPath: string;
        retrievalMode: "single" | "dual";
        packaged: boolean;
        bundledServer: boolean;
        nodeRuntimeKey: string | null;
        nodeExecutable: string;
        appVersion: string;
        downloadPageUrl: string;
      }>;
      /** Main process pushes a new loopback port/token after supervised backend restart. */
      onLoopbackConfig?: (
        handler: (payload: { apiBase?: string; apiAuthToken?: string }) => void,
      ) => () => void;
      checkForUpdates: () => Promise<{ ok: boolean }>;
      showNotification: (payload: {
        title?: string;
        body?: string;
        /** When true, clicking the OS notification focuses the app and opens settings (see onNotificationClick). */
        openSettingsOnClick?: boolean;
        /** When true, focuses the app and opens the review workbench (see onNotificationClick `open_review`). */
        openReviewOnClick?: boolean;
        /** When true, focuses the app and switches to工作台对话（见 onNotificationClick `open_workspace_chat`）。 */
        openChatOnClick?: boolean;
        /** 与 `openChatOnClick` 配合：切到该助手对话（若存在）。 */
        chatAssistantId?: string;
        /** 与 `openChatOnClick` 配合：深链切到该会话（委派完成通知等）。 */
        chatSessionId?: string;
        reviewTaskId?: string;
        reviewMatterId?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      onNotificationClick: (
        handler: (payload: {
          reason?: string;
          reviewTaskId?: string;
          reviewMatterId?: string;
          chatAssistantId?: string;
          chatSessionId?: string;
        }) => void,
      ) => () => void;
      pickWorkspace: () => Promise<{ ok: boolean; path?: string }>;
      /** 工作区所在卷：文件系统类型与剩余字节。失败时不阻断保存。 */
      inspectWorkspaceVolume?: (absPath: string) => Promise<
        | {
            ok: true;
            fstype: string | null;
            driveType: number | null;
            freeBytes: number | null;
          }
        | { ok: false; error?: string }
      >;
      /**
       * 用**当前**端口重新生成并安装 Word 侧载清单。
       *
       * 端口漂移后已侧载的窗格无法自动恢复（发现端点也在旧 base 上），这是唯一恢复通道。
       */
      syncWordAddinManifest: () => Promise<{
        ok: boolean;
        apiBase?: string;
        /** 清单写入的绝对路径。 */
        path?: string;
        /** `word-container` = 直接装进 Word 的侧载目录；`downloads` = 退到下载目录。 */
        location?: "word-container" | "word-windows" | "downloads";
        wpsStatus?: "written" | "unchanged" | "missing";
        bytes?: number;
        instructions?: string;
        error?: string;
      }>;
      pickProject: () => Promise<{ ok: boolean; path?: string }>;
      /** Pick a folder without changing the sidebar project dir. */
      pickFolder?: () => Promise<{ ok: boolean; path?: string }>;
      setProjectDir: (projectDir: string | null) => Promise<{
        ok: boolean;
        projectDir?: string | null;
        apiBase?: string;
        error?: string;
      }>;
      listHostFolders?: () => Promise<{
        ok: boolean;
        mounts?: Array<{ id: string; absPath: string; label?: string; matterId?: string }>;
      }>;
      addHostFolder?: (payload: {
        path: string;
        label?: string;
        matterId?: string;
      }) => Promise<{ ok: boolean; mounts?: unknown[]; projectDir?: string | null; error?: string }>;
      removeHostFolder?: (
        mountId: string,
      ) => Promise<{ ok: boolean; mounts?: unknown[]; projectDir?: string | null; error?: string }>;
      bindHostFolder?: (payload: {
        id: string;
        matterId?: string;
      }) => Promise<{ ok: boolean; mounts?: unknown[]; error?: string }>;
      readModelSettings: () => Promise<{
        ok: boolean;
        hasApiKey?: boolean;
        keychainAvailable?: boolean;
        keyStorage?: "keychain" | "env" | "env+keychain" | "none";
        baseUrl?: string;
        model?: string;
        envFilePath?: string;
        error?: string;
      }>;
      saveSetup: (payload: {
        apiKey: string;
        webSearchApiKey?: string;
        baseUrl?: string;
        model?: string;
        workspaceDir?: string;
        retrievalMode?: "single" | "dual";
      }) => Promise<{
        ok: boolean;
        verified?: boolean;
        latencyMs?: number;
        code?: string;
        apiBase?: string;
        apiAuthToken?: string;
        workspaceDir?: string;
        envFilePath?: string;
        retrievalMode?: "single" | "dual";
        keyStorage?: "keychain" | "env" | "env+keychain" | "none";
        error?: string;
      }>;
      saveCustomModelKey: (payload: {
        id: string;
        apiKey: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      deleteCustomModelKey: (payload: {
        id: string;
      }) => Promise<{ ok: boolean; removed?: boolean; error?: string }>;
      saveMcpServerSecret: (payload: {
        id: string;
        secret: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      deleteMcpServerSecret: (payload: {
        id: string;
      }) => Promise<{ ok: boolean; removed?: boolean; error?: string }>;
      keychainStatus: () => Promise<{
        available: boolean;
        count?: number;
        error?: string;
      }>;
      setOpenLawNpc: (payload: { enabled: boolean }) => Promise<{
        ok: boolean;
        enabled?: boolean;
        apiBase?: string;
        apiAuthToken?: string;
        error?: string;
      }>;
      setRetrievalMode: (mode: "single" | "dual") => Promise<{
        ok: boolean;
        apiBase?: string;
        apiAuthToken?: string;
        retrievalMode?: "single" | "dual";
        error?: string;
      }>;
      openExternal: (url: string) => Promise<void>;
      showItemInFolder: (fullPath: string) => Promise<{ ok: boolean; error?: string }>;
      openWithSystem: (payload: {
        root: "workspace" | "project";
        path: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      openWithWps: (payload: {
        root: "workspace" | "project";
        path: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      fsList: (payload: {
        root: "workspace" | "project";
        path?: string;
      }) => Promise<{
        ok: boolean;
        entries?: Array<{
          name: string;
          path: string;
          kind: "file" | "directory";
          size?: number;
          mtimeMs: number;
        }>;
        error?: string;
      }>;
      fsRead: (payload: {
        root: "workspace" | "project";
        path: string;
      }) => Promise<{
        ok: boolean;
        kind?: "text" | "image";
        content?: string;
        contentBase64?: string;
        mimeType?: string;
        mtimeMs?: number;
        size?: number;
        error?: string;
      }>;
      fsWrite: (payload: {
        root: "workspace" | "project";
        path: string;
        content: string;
        expectedMtimeMs?: number;
      }) => Promise<{
        ok: boolean;
        conflict?: boolean;
        /** 机器可读的拒写原因：root_not_writable | protected_workspace_path。 */
        code?: string;
        mtimeMs?: number;
        size?: number;
        error?: string;
      }>;
      fsMkdir: (payload: {
        root: "workspace" | "project";
        path: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      fsRename: (payload: {
        root: "workspace" | "project";
        fromPath: string;
        toPath: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      fsDelete: (payload: {
        root: "workspace" | "project";
        path: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      fsCopy: (payload: {
        root: "workspace" | "project";
        fromPath: string;
        toPath: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      /** Electron 32+: resolve Finder/Explorer File objects to an absolute path. */
      getPathForFile?: (file: File) => string | null | undefined;
      /** Copy dropped files that sit outside workspace/project into uploads or case materials. */
      importDroppedFiles?: (payload: {
        absPaths: string[];
        matterId?: string | null;
      }) => Promise<{
        ok: boolean;
        items?: Array<{
          root: "workspace" | "project";
          relPath: string;
          kind: "file" | "directory";
          imported?: boolean;
        }>;
        errors?: string[];
        error?: string;
      }>;
      /** Clipboard image bytes with no File.path → materials/uploads. */
      importPastedBytes?: (payload: {
        bytes: ArrayBuffer | Uint8Array;
        fileName?: string | null;
        mimeType?: string | null;
        matterId?: string | null;
      }) => Promise<{
        ok: boolean;
        root?: "workspace" | "project";
        relPath?: string;
        kind?: "file" | "directory";
        imported?: boolean;
        error?: string;
      }>;
      saveTextFileDialog: (payload: {
        content: string;
        defaultName?: string;
      }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; error?: string }>;
      openFilesDialog: (payload?: {
        title?: string;
        multi?: boolean;
        /** macOS/Linux：同一对话框可选文件与文件夹；Windows：先选类型再打开对应对话框 */
        allowDirectories?: boolean;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{
        ok: boolean;
        canceled?: boolean;
        filePaths?: string[];
        pathKinds?: Array<"file" | "directory">;
        error?: string;
      }>;
      onFileMenu: (handler: (payload: { action?: string }) => void) => () => void;
      /** Open a lightweight aux BrowserWindow (e.g. review delivery preview). */
      openAuxWindow?: (payload: {
        kind: "review-preview";
        taskId: string;
        title?: string;
      }) => Promise<{ ok: boolean; focused?: boolean; error?: string }>;
    };
  }
}

/** Marks this file as a module so `declare global` merges onto `Window`. */
export type LawmindDesktopGlobalStub = undefined;
