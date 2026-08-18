import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type http from "node:http";
import { describe, expect, it } from "vitest";
import { handleSidecarRoutes } from "./lawmind-server-route-sidecar.js";
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

function postRequest(payload: unknown): http.IncomingMessage {
  const stream = new PassThrough();
  stream.end(JSON.stringify(payload), "utf8");
  return Object.assign(stream, { method: "POST" }) as unknown as http.IncomingMessage;
}

function getRequest(): http.IncomingMessage {
  return { method: "GET" } as http.IncomingMessage;
}

describe("lawmind-server-route-sidecar", () => {
  it("reports lawmindd status for Desk", async () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    const handled = await handleSidecarRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/sidecar/status"),
      pathname: "/api/sidecar/status",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.json()).toMatchObject({
      ok: true,
      daemon: "lawmindd",
      productLine: "desk",
      ingestPath: "/api/sidecar/ingest",
    });
  });

  it("ingests a Word selection into workspace inbox", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-sidecar-route-"));
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSidecarRoutes({
      ctx,
      req: postRequest({
        source: "word",
        verb: "draft",
        text: "请贵司于七日内支付欠款。",
      }),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/sidecar/ingest"),
      pathname: "/api/sidecar/ingest",
      c: {},
    });
    expect(handled).toBe(true);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    expect(payload.verb).toBe("draft");
    expect(String(payload.prompt)).toContain("写这封");
    expect(fs.existsSync(path.join(workspaceDir, String(payload.relativePath)))).toBe(true);

    const pendingCapture = createResponseCapture();
    await handleSidecarRoutes({
      ctx,
      req: getRequest(),
      res: pendingCapture.res,
      url: new URL("http://127.0.0.1/api/sidecar/pending"),
      pathname: "/api/sidecar/pending",
      c: {},
    });
    const pending = pendingCapture.json() as { items?: Array<{ relativePath?: string; verb?: string }> };
    expect(pending.items?.[0]?.relativePath).toBe(payload.relativePath);
    expect(pending.items?.[0]?.verb).toBe("draft");

    const ackCapture = createResponseCapture();
    await handleSidecarRoutes({
      ctx,
      req: postRequest({ relativePath: payload.relativePath }),
      res: ackCapture.res,
      url: new URL("http://127.0.0.1/api/sidecar/pending/ack"),
      pathname: "/api/sidecar/pending/ack",
      c: {},
    });
    expect(ackCapture.json()).toMatchObject({ ok: true, relativePath: payload.relativePath });

    const emptyCapture = createResponseCapture();
    await handleSidecarRoutes({
      ctx,
      req: getRequest(),
      res: emptyCapture.res,
      url: new URL("http://127.0.0.1/api/sidecar/pending"),
      pathname: "/api/sidecar/pending",
      c: {},
    });
    expect((emptyCapture.json() as { items?: unknown[] }).items).toEqual([]);
  });
});
