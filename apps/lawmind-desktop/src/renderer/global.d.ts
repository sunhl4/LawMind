/// <reference types="vite/client" />

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
      }>;
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
    };
  }
}

/** Marks this file as a module so `declare global` merges onto `Window`. */
export type LawmindDesktopGlobalStub = undefined;
