import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadAssistantsPayload,
  loadCollaborationPayload,
  loadCollaborationSummaryPayload,
  loadHealthPayload,
  loadRecordsPayload,
} from "./lawmind-app-data.js";

describe("lawmind-app-data", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads health payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, modelConfigured: true, retrievalMode: "single" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadHealthPayload("http://127.0.0.1:1234")).resolves.toMatchObject({
      ok: true,
      modelConfigured: true,
      retrievalMode: "single",
    });
  });

  it("loads task/history records in parallel", async () => {
    vi.spyOn(globalThis, "fetch")
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
      );

    await expect(loadRecordsPayload("http://127.0.0.1:1234")).resolves.toEqual({
      tasks: [{ taskId: "t1", summary: "s", status: "done", updatedAt: "2026-01-01" }],
      items: [{ kind: "task", id: "t1", label: "Task", updatedAt: "2026-01-01" }],
    });
  });

  it("loads assistants and presets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
    );

    await expect(loadAssistantsPayload("http://127.0.0.1:1234")).resolves.toEqual({
      assistants: [{ assistantId: "default", displayName: "Default", introduction: "" }],
      presets: [{ id: "p1", displayName: "Preset", promptSection: "..." }],
    });
  });

  it("loads collaboration payload", async () => {
    vi.spyOn(globalThis, "fetch")
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

    await expect(loadCollaborationPayload("http://127.0.0.1:1234")).resolves.toEqual({
      delegations: [{ delegationId: "d1", fromAssistant: "a", toAssistant: "b", task: "t", status: "pending", priority: "high", startedAt: "2026-01-01" }],
      events: [{ eventId: "e1", kind: "delegated", fromAssistantId: "a", toAssistantId: "b", timestamp: "2026-01-01" }],
    });
  });

  it("loads collaboration summary payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, collaborationEnabled: true, delegationCount: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadCollaborationSummaryPayload("http://127.0.0.1:1234")).resolves.toMatchObject({
      ok: true,
      collaborationEnabled: true,
      delegationCount: 2,
    });
  });
});
