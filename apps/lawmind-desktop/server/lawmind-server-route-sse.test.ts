import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import { handleSseRoute } from "./lawmind-server-route-sse.js";
import { LawmindSseBus } from "./lawmind-sse-bus.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let chunks = "";
  const res = {
    writeHead(nextStatus: number, _headers?: Record<string, string>) {
      status = nextStatus;
      return this;
    },
    write(chunk: string | Buffer) {
      chunks += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      }
    },
    on: () => res,
    writableEnded: false,
  } as unknown as http.ServerResponse;
  return { res, get status() { return status; }, get body() { return chunks; } };
}

function createRequest(method: string, url: string, headers?: Record<string, string>): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers ?? {};
  return req;
}

function createCtx(sseBus: LawmindSseBus): LawmindDispatchContext {
  return {
    workspaceDir: "/tmp",
    envFile: undefined,
    userEnvPath: "/tmp/.env",
    policy: { loaded: false, policy: null },
    sseBus,
  };
}

describe("handleSseRoute", () => {
  let bus: LawmindSseBus;

  beforeEach(() => {
    bus = new LawmindSseBus();
  });

  afterEach(() => {
    bus = new LawmindSseBus();
  });

  it("returns false for non-SSE routes", async () => {
    const ctx = createCtx(bus);
    const capture = createResponseCapture();
    const handled = handleSseRoute({
      ctx,
      req: createRequest("GET", "/api/health"),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/health"),
      pathname: "/api/health",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("returns 503 when sse bus is unavailable", async () => {
    const ctx = createCtx(undefined as unknown as LawmindSseBus);
    const capture = createResponseCapture();
    const handled = handleSseRoute({
      ctx: { ...ctx, sseBus: undefined },
      req: createRequest("GET", "/api/events"),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/events"),
      pathname: "/api/events",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(503);
    expect(capture.body).toContain("sse_bus_unavailable");
  });

  it("opens an SSE connection with types from query", async () => {
    const ctx = createCtx(bus);
    const capture = createResponseCapture();
    const req = createRequest("GET", "/api/events?types=fs:change,task:*");
    handleSseRoute({
      ctx,
      req,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/events?types=fs:change,task:*"),
      pathname: "/api/events",
      c: {},
    });
    expect(capture.status).toBe(200);
    expect(capture.body).toContain("event: connected");
    expect(bus.getClientCount()).toBe(1);
    bus.emit({ type: "fs:change", data: { rel: "q.txt" } });
    expect(capture.body).toContain("event: fs:change");
    expect(capture.body).toContain('"rel":"q.txt"');
    bus.emit({ type: "review:status", data: {} });
    expect(capture.body).not.toContain("event: review:status");
    req.emit("close");
  });

  it("accepts repeated types query params from URLSearchParams.append", async () => {
    const ctx = createCtx(bus);
    const capture = createResponseCapture();
    const params = new URLSearchParams();
    params.append("types", "task:*");
    params.append("types", "approval:update");
    const href = `http://127.0.0.1/api/events?${params.toString()}`;
    const req = createRequest("GET", `/api/events?${params.toString()}`);
    handleSseRoute({
      ctx,
      req,
      res: capture.res,
      url: new URL(href),
      pathname: "/api/events",
      c: {},
    });
    bus.emit({ type: "approval:update", data: { id: "a1" } });
    expect(capture.body).toContain("event: approval:update");
    bus.emit({ type: "review:status", data: {} });
    expect(capture.body).not.toContain("event: review:status");
    req.emit("close");
  });

  it("opens an SSE connection with types from header", async () => {
    const ctx = createCtx(bus);
    const capture = createResponseCapture();
    const req = createRequest("GET", "/api/events", { "x-lawmind-sse-types": "review:status" });
    handleSseRoute({
      ctx,
      req,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/events"),
      pathname: "/api/events",
      c: {},
    });
    expect(bus.getClientCount()).toBe(1);
    req.emit("close");
  });

  it("broadcasts events through the route connection", async () => {
    const ctx = createCtx(bus);
    const capture = createResponseCapture();
    const req = createRequest("GET", "/api/events?types=fs:change");
    handleSseRoute({
      ctx,
      req,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/events?types=fs:change"),
      pathname: "/api/events",
      c: {},
    });
    bus.emit({ type: "fs:change", data: { rel: "note.txt" } });
    expect(capture.body).toContain("event: fs:change");
    expect(capture.body).toContain('"rel":"note.txt"');
    req.emit("close");
  });
});
