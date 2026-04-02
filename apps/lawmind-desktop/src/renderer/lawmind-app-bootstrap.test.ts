import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadAppBootstrapSnapshot,
  loadInitialAppConfig,
  loadSettingsCollaborationState,
} from "./lawmind-app-bootstrap.js";

describe("lawmind-app-bootstrap", () => {
  const getWindow = () => globalThis.window as Window;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete getWindow().lawmindDesktop;
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
      }),
    } as Window["lawmindDesktop"];

    await expect(loadInitialAppConfig()).resolves.toEqual({
      apiBase: "http://127.0.0.1:4312",
      workspaceDir: "/tmp/workspace",
      projectDir: "/tmp/project",
      envFilePath: "/tmp/workspace/.env",
      retrievalMode: "dual",
    });
  });

  it("loads the app bootstrap snapshot", async () => {
    vi.stubGlobal("window", {} as Window);
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, modelConfigured: true, retrievalMode: "single" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, tasks: [{ taskId: "t1", summary: "s", status: "done", updatedAt: "2026-01-01" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, items: [{ kind: "task", id: "t1", label: "Task", updatedAt: "2026-01-01" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            assistants: [{ assistantId: "default", displayName: "Default", introduction: "" }],
            presets: [{ id: "p1", displayName: "Preset", promptSection: "..." }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, delegations: [{ delegationId: "d1", fromAssistant: "a", toAssistant: "b", task: "t", status: "pending", priority: "high", startedAt: "2026-01-01" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, events: [{ eventId: "e1", kind: "delegated", fromAssistantId: "a", toAssistantId: "b", timestamp: "2026-01-01" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

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
