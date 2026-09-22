import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleHistoricalScanRoutes } from "./lawmind-server-route-historical-scan.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  const res = {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
  return res;
}

function mockPostReq(body: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

describe("lawmind-server-route-historical-scan", () => {
  let workspaceDir: string;
  let scanRoot: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fsPromises.mkdtemp(path.join("/tmp", "lawmind-scan-route-"));
    scanRoot = await fsPromises.mkdtemp(path.join("/tmp", "lawmind-scan-root-"));
    await fsPromises.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    await fsPromises.mkdir(path.join(scanRoot, "华能采购案"), { recursive: true });
    await fsPromises.writeFile(path.join(scanRoot, "华能采购案", "供货合同.docx"), "x");
    await fsPromises.writeFile(path.join(scanRoot, "华能采购案", "补充协议.docx"), "y");
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fsPromises.rm(workspaceDir, { recursive: true, force: true });
    await fsPromises.rm(scanRoot, { recursive: true, force: true });
  });

  it("adds a root, runs a scan, and lists the latest job", async () => {
    const addRes = mockRes();
    const added = await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({ absPath: scanRoot, label: "历史卷宗" }),
      res: addRes,
      url: new URL("http://127.0.0.1/api/historical-scan/roots"),
      pathname: "/api/historical-scan/roots",
      c: {},
    });
    expect(added).toBe(true);
    expect(addRes.status).toBe(200);
    expect(addRes.body).toMatchObject({ ok: true });

    const runRes = mockRes();
    const ran = await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({}),
      res: runRes,
      url: new URL("http://127.0.0.1/api/historical-scan/run"),
      pathname: "/api/historical-scan/run",
      c: {},
    });
    expect(ran).toBe(true);
    expect(runRes.body).toMatchObject({
      ok: true,
      job: { status: "complete", stats: { cataloged: 2, organizedFolders: 1 } },
    });

    const getRes = mockRes();
    const got = await handleHistoricalScanRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: getRes,
      url: new URL("http://127.0.0.1/api/historical-scan"),
      pathname: "/api/historical-scan",
      c: {},
    });
    expect(got).toBe(true);
    expect(getRes.body).toMatchObject({
      ok: true,
      roots: [{ label: "历史卷宗" }],
      latest: { status: "complete" },
      northStar: { schemaVersion: 2 },
    });
    expect(fs.existsSync(path.join(workspaceDir, "lawmind", "metrics", "north-star.json"))).toBe(true);
  });

  it("accepts incremental:false and defaults a second run to incremental", async () => {
    const addRes = mockRes();
    await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({ absPath: scanRoot, label: "历史卷宗" }),
      res: addRes,
      url: new URL("http://127.0.0.1/api/historical-scan/roots"),
      pathname: "/api/historical-scan/roots",
      c: {},
    });

    const firstRes = mockRes();
    await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({}),
      res: firstRes,
      url: new URL("http://127.0.0.1/api/historical-scan/run"),
      pathname: "/api/historical-scan/run",
      c: {},
    });
    expect(firstRes.body).toMatchObject({
      ok: true,
      job: { stats: { incremental: false, knowledgeQueued: 1 } },
    });

    const secondRes = mockRes();
    await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({}),
      res: secondRes,
      url: new URL("http://127.0.0.1/api/historical-scan/run"),
      pathname: "/api/historical-scan/run",
      c: {},
    });
    expect(secondRes.body).toMatchObject({
      ok: true,
      job: { stats: { incremental: true, filesUnchanged: 2, knowledgeQueued: 0 } },
    });

    const fullRes = mockRes();
    await handleHistoricalScanRoutes({
      ctx,
      req: mockPostReq({ incremental: false }),
      res: fullRes,
      url: new URL("http://127.0.0.1/api/historical-scan/run"),
      pathname: "/api/historical-scan/run",
      c: {},
    });
    expect(fullRes.body).toMatchObject({
      ok: true,
      job: { stats: { incremental: false, filesUnchanged: 0, filesChanged: 2, cataloged: 2 } },
    });
  });
});
