import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, saveSession } from "../../../src/lawmind/agent/session.js";
import { handleSessionExtendedRoutes } from "./lawmind-server-route-sessions.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

describe("lawmind-server-route-sessions extended", () => {
  it("GET context-budget returns token snapshot", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-budget-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);

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

    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };

    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/context-budget`),
      pathname: `/api/sessions/${session.sessionId}/context-budget`,
      c: {},
    });

    expect(handled).toBe(true);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as { ok: boolean; used: number; effectiveLimit: number; level: string };
    expect(body.ok).toBe(true);
    expect(body.used).toBeGreaterThanOrEqual(0);
    expect(body.effectiveLimit).toBeGreaterThan(0);
    expect(["ok", "warn", "compact"]).toContain(body.level);
  });
});
