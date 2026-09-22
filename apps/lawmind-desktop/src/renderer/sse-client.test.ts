/**
 * @vitest-environment node
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import {
  subscribeToSseStream,
  getActiveSseConnectionCount,
  resetSseConnectionsForTests,
  buildSseUrl,
} from "./sse-client";
import { setLoopbackApiAuthToken } from "./lawmind-api-auth";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startMockSseServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    server,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("buildSseUrl", () => {
  it("joins types as a single comma-separated query value", () => {
    const url = buildSseUrl("http://127.0.0.1:9", ["task:*", "approval:update", "fs:change"], null);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("types")).toBe("task:*,approval:update,fs:change");
    expect(parsed.searchParams.getAll("types")).toEqual(["task:*,approval:update,fs:change"]);
  });
});

describe("subscribeToSseStream", () => {
  beforeEach(() => {
    resetSseConnectionsForTests();
    setLoopbackApiAuthToken("test-token");
  });

  afterEach(() => {
    resetSseConnectionsForTests();
    setLoopbackApiAuthToken(null);
    vi.useRealTimers();
  });

  it("connects and receives events", async () => {
    const events: unknown[] = [];
    const { port, close } = await startMockSseServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer test-token");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 1\nevent: fs:change\ndata: {\"rel\":\"a.txt\"}\n\n");
      res.end();
    });
    const unsubscribe = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: (msg) => events.push(msg),
    });
    await sleep(300);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "1", type: "fs:change", data: { rel: "a.txt" } });
    unsubscribe();
    await close();
  });

  it("shares a single connection for multiple subscribers", async () => {
    const events1: unknown[] = [];
    const events2: unknown[] = [];
    let requestCount = 0;
    const { port, close } = await startMockSseServer((req, res) => {
      requestCount += 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 1\nevent: fs:change\ndata: \"x\"\n\n");
    });
    const unsub1 = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: (msg) => events1.push(msg),
    });
    const unsub2 = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: (msg) => events2.push(msg),
    });
    await sleep(300);
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    unsub1();
    unsub2();
    await close();
  });

  it("reconnects after a disconnect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let requestCount = 0;
    const { port, close } = await startMockSseServer((req, res) => {
      requestCount += 1;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 1\nevent: fs:change\ndata: \"x\"\n\n");
      // First response ends quickly; second stays open.
      if (requestCount === 1) {
        res.end();
      }
    });
    const events: unknown[] = [];
    const unsubscribe = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: (msg) => events.push(msg),
    });
    await sleep(200);
    expect(requestCount).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    await sleep(200);
    expect(requestCount).toBeGreaterThanOrEqual(2);
    unsubscribe();
    await close();
  });

  it("sends lastEventId on reconnect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let lastEventId: string | null = null;
    const { port, close } = await startMockSseServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      lastEventId = url.searchParams.get("lastEventId");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 42\nevent: fs:change\ndata: \"x\"\n\n");
      res.end();
    });
    const unsubscribe = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: () => {},
    });
    await sleep(200);
    await vi.advanceTimersByTimeAsync(3000);
    await sleep(200);
    expect(lastEventId).toBe("42");
    unsubscribe();
    await close();
  });

  it("closes connection when all subscribers unsubscribe", async () => {
    const { port, close } = await startMockSseServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("id: 1\nevent: fs:change\ndata: \"x\"\n\n");
    });
    const unsub1 = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: () => {},
    });
    const unsub2 = subscribeToSseStream(`http://127.0.0.1:${port}`, ["fs:change"], {
      onMessage: () => {},
    });
    await sleep(200);
    expect(getActiveSseConnectionCount()).toBe(1);
    unsub1();
    await sleep(50);
    expect(getActiveSseConnectionCount()).toBe(1);
    unsub2();
    await sleep(50);
    expect(getActiveSseConnectionCount()).toBe(0);
    await close();
  });
});
