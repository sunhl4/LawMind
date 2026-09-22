import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOutboundProxy } from "./outbound-proxy.js";

function parseJsonDetail(raw: unknown): Record<string, unknown> {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
  return JSON.parse(text) as Record<string, unknown>;
}

function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (addr && typeof addr === "object" && "port" in addr) {
        resolve(addr.port);
      } else {
        reject(new Error("无法获取端口"));
      }
      s.close();
    });
  });
}

async function startHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await pickPort();
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lm-outbound-"));
}

describe("outbound-proxy", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      process.env[key] = value;
    }
  });

  it("allows http://localhost by default", async () => {
    const server = await startHttpServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    const proxy = createOutboundProxy();
    try {
      const res = await proxy.fetch(`http://127.0.0.1:${server.port}/hello`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.close();
    }
  });

  it("rejects non-local http by default", async () => {
    const proxy = createOutboundProxy();
    await expect(proxy.fetch("http://example.com/")).rejects.toThrow(/非本地 http/);
  });

  it("allows remote http when allowInsecure=true", async () => {
    // 用 mock fetch 避免依赖真实 DNS/网络；只验证策略不再拦截非本地 http。
    const mockFetch = async (): Promise<Response> =>
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    const proxy = createOutboundProxy({
      allowInsecure: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const res = await proxy.fetch("http://example.com/");
    expect(res.status).toBe(200);
  });

  it("rejects a hostname that resolves to link-local metadata", async () => {
    const proxy = createOutboundProxy({
      allowInsecure: true,
      dnsLookup: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    await expect(proxy.fetch("http://metadata.example/latest")).rejects.toThrow(
      /link-local|不可达/,
    );
  });

  it("rejects HTTP_PROXY pointing at link-local metadata", async () => {
    process.env.HTTP_PROXY = "http://169.254.169.254:80";
    process.env.HTTPS_PROXY = "http://169.254.169.254:80";
    const proxy = createOutboundProxy({ allowInsecure: true });
    await expect(proxy.fetch("http://example.com/")).rejects.toThrow(/代理地址不可达|link-local/);
  });

  it("re-validates redirect hops instead of following blindly", async () => {
    const hops: string[] = [];
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      hops.push(href);
      if (href.includes("open.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/secret" },
        });
      }
      return new Response("leaked", { status: 200 });
    };
    const proxy = createOutboundProxy({
      allowInsecure: true,
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    await expect(proxy.fetch("http://open.example/start")).rejects.toThrow(
      /link-local|SSRF|不可达/,
    );
    expect(hops.some((h) => h.includes("169.254"))).toBe(false);
  });

  it("rejects SSRF blacklist (169.254 and 0.0.0.0/8)", async () => {
    const proxy = createOutboundProxy({ allowInsecure: true });
    await expect(proxy.fetch("http://169.254.169.254/")).rejects.toThrow(/SSRF|link-local/);
    await expect(proxy.fetch("http://0.0.0.0/")).rejects.toThrow(/SSRF|0\.0\.0\.0/);
  });

  it("rejects loopback/private when allowLocalNetwork=false", async () => {
    const proxy = createOutboundProxy({ allowLocalNetwork: false, allowInsecure: true });
    await expect(proxy.fetch("http://127.0.0.1/")).rejects.toThrow(/loopback/);
    await expect(proxy.fetch("http://192.168.1.1/")).rejects.toThrow(/私网/);
  });

  it("allows https endpoints", async () => {
    // 用 mock fetch 验证 https 不会被默认拦截，不依赖真实 TLS 握手。
    const mockFetch = async (): Promise<Response> =>
      new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } });
    const proxy = createOutboundProxy({ fetchImpl: mockFetch as unknown as typeof fetch });
    const res = await proxy.fetch("https://api.example.com/v1/chat");
    expect(res.status).toBe(200);
  });

  it("times out slow requests", async () => {
    const server = await startHttpServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("late");
      }, 10_000);
    });
    const proxy = createOutboundProxy({ timeoutMs: 50 });
    await expect(proxy.fetch(`http://127.0.0.1:${server.port}/slow`)).rejects.toThrow();
    await server.close();
  });

  it("writes outbound_http audit without request/response body", async () => {
    const auditDir = tmpDir();
    const server = await startHttpServer((req, res) => {
      expect(req.url).toBe("/audit-test");
      res.writeHead(201, { "content-type": "application/json" });
      res.end('{"secret":"hidden"}');
    });
    const proxy = createOutboundProxy({
      auditDir,
      taskId: "test-task",
      actor: "model",
      requestTag: "unit-test",
    });
    try {
      const res = await proxy.fetch(`http://127.0.0.1:${server.port}/audit-test`, {
        method: "POST",
        body: JSON.stringify({ password: "should-not-appear-in-audit" }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(201);
      const today = new Date().toISOString().slice(0, 10);
      const logPath = path.join(auditDir, `${today}.jsonl`);
      const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(event.kind).toBe("outbound_http");
      expect(event.taskId).toBe("test-task");
      expect(event.actor).toBe("model");
      const detail = parseJsonDetail(event.detail);
      expect(detail.method).toBe("POST");
      expect(detail.host).toBe("127.0.0.1");
      expect(detail.pathname).toBe("/audit-test");
      expect(detail.status).toBe(201);
      expect(detail.durationMs).toEqual(expect.any(Number));
      expect(detail.tag).toBe("unit-test");
      expect(detail).not.toHaveProperty("body");
      expect(String(event.detail)).not.toContain("password");
      expect(String(event.detail)).not.toContain("hidden");
    } finally {
      await server.close();
      fs.rmSync(auditDir, { recursive: true, force: true });
    }
  });

  it("honors HTTP_PROXY for http targets", async () => {
    const target = await startHttpServer((_req, res) => {
      res.writeHead(200);
      res.end("target");
    });
    const proxyServer = await startHttpServer((req, res) => {
      // HTTP 代理收到的是完整目标 URL。
      if (req.url === `http://127.0.0.1:${target.port}/via-proxy`) {
        res.writeHead(200);
        res.end("proxy-ok");
        return;
      }
      res.writeHead(502);
      res.end("unexpected");
    });
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyServer.port}`;
    process.env.NO_PROXY = "";
    const proxy = createOutboundProxy();
    try {
      const res = await proxy.fetch(`http://127.0.0.1:${target.port}/via-proxy`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("proxy-ok");
    } finally {
      await target.close();
      await proxyServer.close();
    }
  });

  it("respects NO_PROXY", async () => {
    const proxyServer = await startHttpServer((req, res) => {
      res.writeHead(200);
      res.end(`proxy-url:${req.url}`);
    });
    const target = await startHttpServer((_req, res) => {
      res.writeHead(200);
      res.end("direct");
    });
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxyServer.port}`;
    process.env.NO_PROXY = "127.0.0.1";
    const proxy = createOutboundProxy();
    try {
      const res = await proxy.fetch(`http://127.0.0.1:${target.port}/direct`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("direct");
    } finally {
      await target.close();
      await proxyServer.close();
    }
  });
});
