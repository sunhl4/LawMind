import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAppDetail } from "./lawmind-app-detail.js";

describe("lawmind-app-detail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads task detail payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          task: {
            taskId: "task-1",
            summary: "Prepare a memo",
            status: "done",
            kind: "agent.task",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
          checkpoints: [{ checkpointId: "cp-1", label: "Ready", status: "done" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await expect(loadAppDetail("http://127.0.0.1:4312", "task", "task-1")).resolves.toMatchObject({
      task: {
        taskId: "task-1",
        summary: "Prepare a memo",
        status: "done",
      },
      checkpoints: [{ checkpointId: "cp-1", label: "Ready", status: "done" }],
    });
  });

  it("throws the server message when detail loading fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(loadAppDetail("http://127.0.0.1:4312", "draft", "draft-1")).rejects.toThrow("not found");
  });
});
