import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleMatterReplicaRoutes } from "./lawmind-server-route-matter-replica.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const tmpDirs: string[] = [];

function tmpWorkspace(edition: "solo" | "firm"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-replica-api-"));
  tmpDirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "lawmind.policy.json"),
    JSON.stringify({ schemaVersion: 1, edition }),
    "utf8",
  );
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function mockRes(): {
  res: http.ServerResponse;
  statusCode: number;
  body: unknown;
} {
  let statusCode = 200;
  let body: unknown = null;
  const res = {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end(chunk?: string) {
      if (chunk) {
        body = JSON.parse(chunk);
      }
      statusCode = this.statusCode;
      return this;
    },
    writeHead(code: number) {
      this.statusCode = code;
      statusCode = code;
      return this;
    },
  } as unknown as http.ServerResponse & { statusCode: number };
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

async function call(
  workspaceDir: string,
  pathname: string,
  method: string,
  query = "",
): Promise<{ statusCode: number; body: unknown }> {
  const bag = mockRes();
  const url = new URL(`http://127.0.0.1${pathname}${query}`);
  const handled = await handleMatterReplicaRoutes({
    ctx: {
      workspaceDir,
      envFile: undefined,
      userEnvPath: "",
      policy: { schemaVersion: 1 },
    },
    req: { method, headers: {} } as http.IncomingMessage,
    res: bag.res,
    url,
    pathname,
    c: {},
  } as LawmindRouteContext);
  expect(handled).toBe(true);
  return { statusCode: bag.statusCode, body: bag.body };
}

describe("matter-replica routes", () => {
  it("status is disabled on solo", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/status", "GET");
    expect(r.statusCode).toBe(200);
    expect((r.body as { enabled: boolean }).enabled).toBe(false);
  });

  it("status is enabled on firm", async () => {
    const ws = tmpWorkspace("firm");
    const r = await call(ws, "/api/matter-replica/status", "GET");
    expect(r.statusCode).toBe(200);
    expect((r.body as { enabled: boolean }).enabled).toBe(true);
  });

  it("membership returns 403 when solo", async () => {
    const ws = tmpWorkspace("solo");
    const r = await call(ws, "/api/matter-replica/membership", "GET", "?matterId=m1");
    expect(r.statusCode).toBe(403);
  });
});
