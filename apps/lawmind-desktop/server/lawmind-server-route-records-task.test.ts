import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

describe("GET /api/tasks/:id", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns task with statusLabel", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-task-route-"));
    dirs.push(ws);
    const tasksDir = path.join(ws, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(
      path.join(tasksDir, "task-e2e-1.json"),
      JSON.stringify({
        taskId: "task-e2e-1",
        kind: "draft.word",
        summary: "test",
        output: "docx",
        riskLevel: "low",
        requiresConfirmation: false,
        status: "completed",
        reviewStatus: "approved",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    let status = 0;
    let raw = "";
    const res = {
      writeHead(s: number) {
        status = s;
      },
      end(b: string) {
        raw = b;
      },
    } as unknown as http.ServerResponse;

    const handled = await handleRecordRoutes({
      ctx: {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(ws, ".env"),
        policy: { loaded: false },
      } as LawmindDispatchContext,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/tasks/task-e2e-1"),
      pathname: "/api/tasks/task-e2e-1",
      c: {},
    });

    expect(handled).toBe(true);
    expect(status).toBe(200);
    const j = JSON.parse(raw) as { ok?: boolean; task?: { statusLabel?: string } };
    expect(j.ok).toBe(true);
    expect(j.task?.statusLabel).toBe("可渲染");
  });
});
