import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { EventEmitter } from "node:events";
import { LawmindSseBus, LAWMIND_SSE_HEARTBEAT_MS } from "./lawmind-sse-bus.js";

function createMockRes(): http.ServerResponse & {
  chunks: string[];
  ended: boolean;
  writeHead: ReturnType<typeof vi.fn>;
} {
  const chunks: string[] = [];
  const writeHead = vi.fn();
  const res = {
    chunks,
    ended: false,
    writeHead,
    write: vi.fn((chunk: string | Buffer) => {
      if (res.ended) {
        return false;
      }
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }),
    end: vi.fn(() => {
      res.ended = true;
    }),
    on: vi.fn(),
    writableEnded: false,
  } as unknown as http.ServerResponse & { chunks: string[]; ended: boolean };
  return res;
}

function createMockReq(): http.IncomingMessage {
  const req = new EventEmitter() as http.IncomingMessage;
  return req;
}

describe("LawmindSseBus", () => {
  let bus: LawmindSseBus;

  beforeEach(() => {
    bus = new LawmindSseBus();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens a connection and sends a connected event", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {});
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "content-type": "text/event-stream; charset=utf-8" }),
    );
    expect(res.chunks[0]).toContain("event: connected");
    expect(res.chunks[0]).toContain("data:");
  });

  it("broadcasts events to a subscribed client", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {}, { types: ["fs:change"] });
    bus.emit({ type: "fs:change", data: { rel: "test.txt" } });
    expect(res.chunks.some((c) => c.includes("event: fs:change") && c.includes('"rel":"test.txt"'))).toBe(
      true,
    );
  });

  it("does not broadcast events to clients with non-matching subscriptions", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {}, { types: ["review:status"] });
    bus.emit({ type: "fs:change", data: { rel: "test.txt" } });
    expect(res.chunks.some((c) => c.includes("event: fs:change"))).toBe(false);
  });

  it("supports wildcard subscriptions like task:*", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {}, { types: ["task:*"] });
    bus.emit({ type: "task:abc:update", data: { status: "running" } });
    expect(res.chunks.some((c) => c.includes("event: task:abc:update"))).toBe(true);
  });

  it("supports catch-all subscription", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {}, { types: ["*"] });
    bus.emit({ type: "anything", data: {} });
    expect(res.chunks.some((c) => c.includes("event: anything"))).toBe(true);
  });

  it("broadcasts to multiple clients", () => {
    const req1 = createMockReq();
    const res1 = createMockRes();
    const req2 = createMockReq();
    const res2 = createMockRes();
    bus.handleConnection(req1, res1, {}, { types: ["fs:change"] });
    bus.handleConnection(req2, res2, {}, { types: ["fs:change"] });
    bus.emit({ type: "fs:change", data: { rel: "x" } });
    expect(res1.chunks.some((c) => c.includes("event: fs:change"))).toBe(true);
    expect(res2.chunks.some((c) => c.includes("event: fs:change"))).toBe(true);
  });

  it("sends heartbeats periodically", async () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {});
    await vi.advanceTimersByTimeAsync(LAWMIND_SSE_HEARTBEAT_MS + 100);
    expect(res.chunks.some((c) => c.includes(": heartbeat"))).toBe(true);
  });

  it("closes the client when the request closes", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {});
    expect(bus.getClientCount()).toBe(1);
    req.emit("close");
    expect(bus.getClientCount()).toBe(0);
    expect(res.ended).toBe(true);
  });

  it("closes the client when write fails", () => {
    const req = createMockReq();
    const res = createMockRes();
    res.write = vi.fn(() => false);
    bus.handleConnection(req, res, {});
    bus.emit({ type: "fs:change", data: {} });
    expect(bus.getClientCount()).toBe(0);
  });

  it("allows test injection of a custom event source", () => {
    const source = new EventEmitter();
    bus.setEventSource(source);
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {}, { types: ["fs:change"] });
    source.emit("lawmind:sse", { type: "fs:change", data: { injected: true } });
    expect(res.chunks.some((c) => c.includes('"injected":true'))).toBe(true);
  });

  it("replays buffered events after lastEventId", () => {
    const req1 = createMockReq();
    const res1 = createMockRes();
    bus.handleConnection(req1, res1, {}, { types: ["fs:change"] });
    bus.emit({ type: "fs:change", data: { n: 1 }, eventId: "10" });
    bus.emit({ type: "fs:change", data: { n: 2 }, eventId: "11" });
    req1.emit("close");

    const req2 = createMockReq();
    const res2 = createMockRes();
    bus.handleConnection(req2, res2, {}, { types: ["fs:change"], lastEventId: "10" });
    expect(res2.chunks.some((c) => c.includes("id: 11") && c.includes('"n":2'))).toBe(true);
    expect(res2.chunks.some((c) => c.includes("id: 10"))).toBe(false);
    req2.emit("close");
  });

  it("uses custom event id if provided", () => {
    const req = createMockReq();
    const res = createMockRes();
    bus.handleConnection(req, res, {});
    bus.emit({ type: "fs:change", data: {}, eventId: "custom-42" });
    expect(res.chunks.some((c) => c.includes("id: custom-42"))).toBe(true);
  });
});
