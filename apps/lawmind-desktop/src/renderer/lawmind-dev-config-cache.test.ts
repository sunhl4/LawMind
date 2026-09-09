/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistDevAppConfig, refreshLoopbackAuthFromDesktop } from "./lawmind-dev-config-cache.ts";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("lawmind-dev-config-cache", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", mockStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("persists loopback API coordinates", () => {
    persistDevAppConfig({
      apiBase: "http://127.0.0.1:4312",
      apiAuthToken: "secret",
      workspaceDir: "/tmp/ws",
      projectDir: null,
      envFilePath: "",
      retrievalMode: "single",
    });
    expect(localStorage.getItem("lawmind.dev.apiBase")).toBe("http://127.0.0.1:4312");
    expect(localStorage.getItem("lawmind.dev.apiAuthToken")).toBe("secret");
  });

  it("refreshLoopbackAuthFromDesktop adopts Electron token", async () => {
    const getConfig = vi.fn(async () => ({
      apiBase: "http://127.0.0.1:50501",
      apiAuthToken: "new-token",
      workspaceDir: "/tmp/ws",
      projectDir: null,
      envFilePath: "",
      retrievalMode: "single" as const,
    }));
    window.lawmindDesktop = { getConfig } as unknown as NonNullable<Window["lawmindDesktop"]>;
    const fresh = await refreshLoopbackAuthFromDesktop();
    expect(fresh).toEqual({ apiBase: "http://127.0.0.1:50501", apiAuthToken: "new-token" });
    expect(localStorage.getItem("lawmind.dev.apiAuthToken")).toBe("new-token");
  });

  it("refreshLoopbackAuthFromDesktop ignores port 0 and empty token", async () => {
    window.lawmindDesktop = {
      getConfig: async () => ({
        apiBase: "http://127.0.0.1:0",
        apiAuthToken: "",
        workspaceDir: "/tmp/ws",
        projectDir: null,
        envFilePath: "",
        retrievalMode: "single" as const,
      }),
    } as unknown as NonNullable<Window["lawmindDesktop"]>;
    await expect(refreshLoopbackAuthFromDesktop()).resolves.toBeNull();
  });
});
