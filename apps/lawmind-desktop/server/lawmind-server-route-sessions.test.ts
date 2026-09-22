import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginLiveTurnProgress,
  finishLiveTurnProgress,
  resetLiveTurnProgressStore,
} from "../../../src/lawmind/agent/live-turn-progress.js";
import { createSession, loadSession, saveSession } from "../../../src/lawmind/agent/session.js";
import { isTurnAbortRequested, resetTurnAbortStore } from "../../../src/lawmind/agent/turn-abort.js";
import { handleSessionExtendedRoutes } from "./lawmind-server-route-sessions.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const stream = new PassThrough();
  if (body !== undefined) {
    stream.end(JSON.stringify(body), "utf8");
  } else {
    stream.end("{}", "utf8");
  }
  (stream as unknown as http.IncomingMessage).method = method;
  return stream as unknown as http.IncomingMessage;
}

function mockRes(): { res: http.ServerResponse; get: () => { status: number; raw: string } } {
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
  return {
    res,
    get: () => ({ status, raw }),
  };
}

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

  afterEach(() => {
    resetTurnAbortStore();
    resetLiveTurnProgressStore();
  });

  it("POST messages/mutate returns 409 while turn is running", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-mutate-busy-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
    );
    saveSession(ws, session);
    beginLiveTurnProgress(session.sessionId);

    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { uiIndex: 0, mode: "truncate" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/messages/mutate`),
      pathname: `/api/sessions/${session.sessionId}/messages/mutate`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(409);
    const body = JSON.parse(get().raw) as { ok: boolean; error: string };
    expect(body.error).toBe("turn_in_progress");
    finishLiveTurnProgress(session.sessionId, "completed");
  });

  it("POST messages/mutate delete_pair removes Q&A", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-mutate-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    saveSession(ws, session);

    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { uiIndex: 0, mode: "delete_pair" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/messages/mutate`),
      pathname: `/api/sessions/${session.sessionId}/messages/mutate`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      messages: Array<{ role: string; text: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.messages.map((m) => m.text)).toEqual(["q2", "a2"]);
    const reloaded = loadSession(ws, session.sessionId);
    expect(reloaded?.conversationHistory.map((m) => m.content)).toEqual(["q2", "a2"]);
  });

  it("POST abort marks turn abort requested", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-abort-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", {}),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/abort`),
      pathname: `/api/sessions/${session.sessionId}/abort`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    expect(isTurnAbortRequested(session.sessionId)).toBe(true);
  });

  it("PUT/GET/DELETE plan-handoff round-trips on session.json", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-plan-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const put = mockRes();
    expect(
      await handleSessionExtendedRoutes({
        ctx,
        req: jsonReq("PUT", { planText: "执行计划：先检索再起草" }),
        res: put.res,
        url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
        pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
        c: {},
      }),
    ).toBe(true);
    expect(put.get().status).toBe(200);
    const getRes = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: getRes.res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
      pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
      c: {},
    });
    const got = JSON.parse(getRes.get().raw) as {
      ok: boolean;
      planHandoff: { planText: string } | null;
    };
    expect(got.planHandoff?.planText).toContain("先检索");
    const del = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: { method: "DELETE" } as http.IncomingMessage,
      res: del.res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
      pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
      c: {},
    });
    expect(loadSession(ws, session.sessionId)?.planHandoff).toBeUndefined();
  });

  it("POST inject queues mid-turn pins on sidecar", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-inject-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", {
        contextPins: [{ pinKind: "file", root: "workspace", relPath: "cases/m1/a.docx", kind: "file" }],
      }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/inject`),
      pathname: `/api/sessions/${session.sessionId}/inject`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      pendingCount: number;
      inboxKind?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.pendingCount).toBe(1);
    expect(body.inboxKind).toBe("inject");
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.pending-pins.json`))).toBe(
      true,
    );
  });

  it("POST steer queues mid-turn notes on sidecar", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-steer-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { text: "不要写结论，先对责任上限" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/steer`),
      pathname: `/api/sessions/${session.sessionId}/steer`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      pendingCount: number;
      inboxKind?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.pendingCount).toBe(1);
    expect(body.inboxKind).toBe("steer");
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.pending-steer.json`))).toBe(
      true,
    );
  });
});
