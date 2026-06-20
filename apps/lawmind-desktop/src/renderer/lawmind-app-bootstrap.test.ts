/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
} from "./lawmind-app-bootstrap.js";

describe("lawmind-app-bootstrap", () => {
  const getWindow = () => globalThis.window as Window;

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete getWindow().lawmindDesktop;
  });

  it("loads initial config from cached dev API when preload is absent", async () => {
    vi.stubGlobal("window", {} as Window);
    vi.stubGlobal("localStorage", mockStorage());
    localStorage.setItem("lawmind.dev.apiBase", "http://127.0.0.1:4312");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadInitialAppConfig()).resolves.toMatchObject({
      apiBase: "http://127.0.0.1:4312",
      workspaceDir: "(browser dev — use Electron for file access)",
    });
  });

  it("loads initial config from the Electron bridge", async () => {
    vi.stubGlobal("window", {} as Window);
    getWindow().lawmindDesktop = {
      getConfig: vi.fn().mockResolvedValue({
        apiBase: "http://127.0.0.1:4312",
        workspaceDir: "/tmp/workspace",
        projectDir: "/tmp/project",
        envFilePath: "/tmp/workspace/.env",
        lawMindRoot: "/tmp/root",
        configPath: "/tmp/root/config.json",
        retrievalMode: "dual",
        packaged: false,
        bundledServer: false,
        nodeRuntimeKey: null,
        nodeExecutable: "node",
        appVersion: "0.0.0-test",
        downloadPageUrl: "https://cdn.test/lawmind/download",
      }),
    } as unknown as NonNullable<Window["lawmindDesktop"]>;

    await expect(loadInitialAppConfig()).resolves.toEqual({
      apiBase: "http://127.0.0.1:4312",
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      envFilePath: "/tmp/workspace/.env",
      retrievalMode: "dual",
      packaged: false,
      appVersion: "0.0.0-test",
      downloadPageUrl: "https://cdn.test/lawmind/download",
    });
  });

  it("loads the app bootstrap snapshot", async () => {
    vi.stubGlobal("window", {} as Window);

    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      let body: Record<string, unknown>;
      if (url.includes("/api/health")) {
        body = { ok: true, modelConfigured: true, retrievalMode: "single" };
      } else if (url.includes("/api/tasks")) {
        body = { ok: true, tasks: [{ taskId: "t1", summary: "s", status: "done", updatedAt: "2026-01-01" }] };
      } else if (url.includes("/api/history")) {
        body = {
          ok: true,
          items: [{ kind: "task", id: "t1", label: "Task", updatedAt: "2026-01-01" }],
        };
      } else if (url.includes("/api/assistants")) {
        body = {
          ok: true,
          assistants: [{ assistantId: "default", displayName: "Default", introduction: "" }],
          presets: [{ id: "p1", displayName: "Preset", promptSection: "..." }],
        };
      } else if (url.includes("/api/delegations")) {
        body = {
          ok: true,
          delegations: [
            {
              delegationId: "d1",
              fromAssistant: "a",
              toAssistant: "b",
              task: "t",
              status: "pending",
              priority: "high",
              startedAt: "2026-01-01",
            },
          ],
        };
      } else if (url.includes("/api/collaboration-events")) {
        body = {
          ok: true,
          events: [
            {
              eventId: "e1",
              kind: "delegated",
              fromAssistantId: "a",
              toAssistantId: "b",
              timestamp: "2026-01-01",
            },
          ],
        };
      } else if (url.includes("/api/platform/gate-history")) {
        body = { ok: true, items: [] };
      } else {
        return Promise.reject(new Error(`Unexpected fetch in bootstrap test: ${url}`));
      }

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    await expect(loadAppBootstrapSnapshot("http://127.0.0.1:4312")).resolves.toMatchObject({
      health: { modelConfigured: true, retrievalMode: "single" },
      records: {
        tasks: [{ taskId: "t1", summary: "s", status: "done", updatedAt: "2026-01-01" }],
        items: [{ kind: "task", id: "t1", label: "Task", updatedAt: "2026-01-01" }],
      },
      assistants: {
        assistants: [{ assistantId: "default", displayName: "Default", introduction: "" }],
        presets: [{ id: "p1", displayName: "Preset", promptSection: "..." }],
      },
      collaboration: {
        delegations: [{ delegationId: "d1", fromAssistant: "a", toAssistant: "b", task: "t", status: "pending", priority: "high", startedAt: "2026-01-01" }],
        events: [{ eventId: "e1", kind: "delegated", fromAssistantId: "a", toAssistantId: "b", timestamp: "2026-01-01" }],
      },
    });
  });

  it("returns normalized collaboration settings", async () => {
    vi.stubGlobal("window", {} as Window);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, collaborationEnabled: true, collaborationHint: "enabled", delegationCount: 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadSettingsCollaborationState("http://127.0.0.1:4312")).resolves.toEqual({
      collaborationEnabled: true,
      collaborationHint: "enabled",
      delegationCount: 3,
    });
  });
});
