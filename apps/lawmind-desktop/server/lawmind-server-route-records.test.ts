import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSession } from "../../../src/lawmind/agent/session.js";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

describe("lawmind-server-route-records", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    await expect(
      handleRecordRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("POST /api/sessions/delete removes session files", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rec-del-post-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
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
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    const req = stream as unknown as http.IncomingMessage;
    req.method = "POST";
    const body = JSON.stringify({ sessionId: session.sessionId, assistantId: "default" });
    const p = handleRecordRoutes({
      ctx: {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(ws, ".env"),
        policy: { loaded: false },
      } as LawmindDispatchContext,
      req,
      res,
      url: new URL("http://127.0.0.1/api/sessions/delete"),
      pathname: "/api/sessions/delete",
      c: {},
    });
    stream.end(body, "utf8");
    const handled = await p;
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ ok: true, sessionId: session.sessionId });
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.json`))).toBe(false);
  });

  it("POST /api/sessions/delete is idempotent when session is already gone", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rec-del-idem-"));
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
    const { PassThrough } = await import("node:stream");
    const stream = new PassThrough();
    const req = stream as unknown as http.IncomingMessage;
    req.method = "POST";
    const missingId = "00000000-0000-4000-8000-000000000099";
    const body = JSON.stringify({ sessionId: missingId, assistantId: "default" });
    const p = handleRecordRoutes({
      ctx: {
        workspaceDir: ws,
        envFile: undefined,
        userEnvPath: path.join(ws, ".env"),
        policy: { loaded: false },
      } as LawmindDispatchContext,
      req,
      res,
      url: new URL("http://127.0.0.1/api/sessions/delete"),
      pathname: "/api/sessions/delete",
      c: {},
    });
    stream.end(body, "utf8");
    const handled = await p;
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({
      ok: true,
      sessionId: missingId,
      alreadyDeleted: true,
    });
  });

  it("DELETE /api/sessions/:id removes session files", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-rec-del-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
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
      req: { method: "DELETE" } as http.IncomingMessage,
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}?assistantId=default`),
      pathname: `/api/sessions/${session.sessionId}`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ ok: true, sessionId: session.sessionId });
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.json`))).toBe(false);
  });

  it("GET /api/sessions/:id/live-turn returns in-memory progress", async () => {
    const {
      beginLiveTurnProgress,
      applyLiveTurnEvent,
      resetLiveTurnProgressStore,
    } = await import("../../../src/lawmind/agent/live-turn-progress.js");
    resetLiveTurnProgressStore();
    const session = createSession({
      workspaceDir: os.tmpdir(),
      actorId: "lawyer",
      assistantId: "default",
    });
    beginLiveTurnProgress(session.sessionId);
    applyLiveTurnEvent(session.sessionId, { type: "round_start", roundIndex: 1 });
    applyLiveTurnEvent(session.sessionId, {
      type: "tool_call_start",
      roundIndex: 1,
      toolCallId: "tc1",
      toolName: "write_document",
      args: {},
    });

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
        workspaceDir: os.tmpdir(),
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      } as LawmindDispatchContext,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/live-turn`),
      pathname: `/api/sessions/${session.sessionId}/live-turn`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as {
      ok?: boolean;
      progress?: { status?: string; steps?: Array<{ label: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.progress?.status).toBe("running");
    expect(body.progress?.steps?.some((s) => s.label.includes("写回"))).toBe(true);
    resetLiveTurnProgressStore();
  });

  it("GET /api/sessions/:id/live-turn returns idle when no progress", async () => {
    const { resetLiveTurnProgressStore } = await import(
      "../../../src/lawmind/agent/live-turn-progress.js"
    );
    resetLiveTurnProgressStore();
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
        workspaceDir: os.tmpdir(),
        envFile: undefined,
        userEnvPath: path.join(os.tmpdir(), "x.env"),
        policy: { loaded: false },
      } as LawmindDispatchContext,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/sessions/unknown-session/live-turn"),
      pathname: "/api/sessions/unknown-session/live-turn",
      c: {},
    });
    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(JSON.parse(raw)).toEqual({ ok: true, progress: null, status: "idle" });
  });
});
