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
      pickProject: () => Promise<{ ok: boolean; path?: string }>;
      /** Pick a folder without changing the sidebar project dir. */
      pickFolder?: () => Promise<{ ok: boolean; path?: string }>;
      setProjectDir: (projectDir: string | null) => Promise<{
        ok: boolean;
        projectDir?: string | null;
        apiBase?: string;
        error?: string;
      }>;
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
