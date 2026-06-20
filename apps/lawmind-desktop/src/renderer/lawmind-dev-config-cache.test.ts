/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCachedDevAppConfig, persistDevAppConfig } from "./lawmind-dev-config-cache.ts";

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

  it("persists and reloads loopback API when health responds", async () => {
    persistDevAppConfig({
      apiBase: "http://127.0.0.1:4312",
      apiAuthToken: "secret",
      workspaceDir: "/tmp/ws",
      projectDir: null,
      envFilePath: "",
      retrievalMode: "single",
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadCachedDevAppConfig()).resolves.toMatchObject({
      apiBase: "http://127.0.0.1:4312",
      apiAuthToken: "secret",
      workspaceDir: "(browser dev — use Electron for file access)",
    });
  });

  it("returns null when cached API is unreachable", async () => {
    localStorage.setItem("lawmind.dev.apiBase", "http://127.0.0.1:49999");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(loadCachedDevAppConfig()).resolves.toBeNull();
  });
});
