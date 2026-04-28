/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LAWMIND_DOCS_BASE?: string;
  readonly VITE_LAWMIND_GITHUB_BLOB_BASE?: string;
  readonly VITE_LAWMIND_DOWNLOAD_PAGE_URL?: string;
}

declare global {
  interface Window {
    lawmindDesktop?: {
      getConfig: () => Promise<{
        apiBase: string;
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
        reviewTaskId?: string;
        reviewMatterId?: string;
      }) => Promise<{ ok: boolean; error?: string }>;
      onNotificationClick: (
        handler: (payload: { reason?: string; reviewTaskId?: string; reviewMatterId?: string }) => void,
      ) => () => void;
      pickWorkspace: () => Promise<{ ok: boolean; path?: string }>;
      pickProject: () => Promise<{ ok: boolean; path?: string }>;
      setProjectDir: (projectDir: string | null) => Promise<{
        ok: boolean;
        projectDir?: string | null;
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
        apiBase?: string;
        workspaceDir?: string;
        envFilePath?: string;
        retrievalMode?: "single" | "dual";
        error?: string;
      }>;
      setRetrievalMode: (mode: "single" | "dual") => Promise<{
        ok: boolean;
        apiBase?: string;
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
        content?: string;
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
      onFileMenu: (handler: (payload: { action?: string }) => void) => () => void;
    };
  }
}

/** Marks this file as a module so `declare global` merges onto `Window`. */
export type LawmindDesktopGlobalStub = undefined;
