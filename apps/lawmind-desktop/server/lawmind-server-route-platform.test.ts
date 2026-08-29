import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emitPlatformGateSnapshot } from "../../../src/lawmind/platform/audit-gate.js";
import { handlePlatformRoutes } from "./lawmind-server-route-platform.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    end(chunk?: string | Buffer) {
      body += chunk ? chunk.toString() : "";
      return this;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

describe("lawmind-server-route-platform", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/platform/gate-history returns recent snapshots", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-platform-route-"));
    tempDirs.push(ws);
    await emitPlatformGateSnapshot(path.join(ws, "audit"), {
      taskId: "draft-1",
      source: "review",
      actor: "lawyer",
      executionState: {
        phase: "approval",
        status: "awaiting_approval",
        recoverable: true,
      },
      gateDecisions: [{ gate: "approval_gate", decision: "awaiting_confirmation" }],
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    const handled = await handlePlatformRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/platform/gate-history?limit=10"),
      pathname: "/api/platform/gate-history",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const items = payload.items as Array<{ taskId: string; source: string }>;
    expect(items.length).toBe(1);
    expect(items[0]?.taskId).toBe("draft-1");
    expect(items[0]?.source).toBe("review");
  });
});
