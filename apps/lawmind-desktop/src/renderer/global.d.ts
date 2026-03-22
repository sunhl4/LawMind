

declare global {
  interface Window {
    lawmindDesktop?: {
      getConfig: () => Promise<{
        apiBase: string;
        workspaceDir: string;
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
    };
  }
}
