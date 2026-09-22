import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { describe, expect, it } from "vitest";
import { handleRolesRoutes } from "./lawmind-server-route-roles.js";
import type { LawmindDispatchContext, LawmindRouteContext } from "./lawmind-server-route-types.js";

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

function buildCtx(): LawmindDispatchContext {
  return {
    workspaceDir: os.tmpdir(),
    envFile: undefined,
    userEnvPath: path.join(os.tmpdir(), ".env.lawmind"),
    policy: { loaded: false },
  };
}

function buildRouteCtx(method: string, pathname: string): LawmindRouteContext {
  const capture = createResponseCapture();
  return {
    ctx: buildCtx(),
    req: { method } as http.IncomingMessage,
    res: capture.res,
    url: new URL(`http://127.0.0.1${pathname}`),
    pathname,
    c: {},
    // @ts-expect-error attach capture for tests
    __capture: capture,
  };
}

describe("lawmind-server-route-roles", () => {
  it("returns false for non-roles routes", async () => {
    const route = buildRouteCtx("GET", "/api/other");
    const handled = await handleRolesRoutes(route);
    expect(handled).toBe(false);
  });

  it("lists built-in roles", async () => {
    const route = buildRouteCtx("GET", "/api/roles");
    const handled = await handleRolesRoutes(route);
    expect(handled).toBe(true);
    // @ts-expect-error capture attached for tests
    const capture = route.__capture as { status: number; json: () => Record<string, unknown> };
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const roles = payload.roles as Array<{ roleId: string; displayName: string }>;
    expect(Array.isArray(roles)).toBe(true);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) {
      expect(typeof r.roleId).toBe("string");
      expect(typeof r.displayName).toBe("string");
    }
  });

  it("returns single role detail by id", async () => {
    const list = buildRouteCtx("GET", "/api/roles");
    await handleRolesRoutes(list);
    // @ts-expect-error capture attached for tests
    const listCapture = list.__capture as { json: () => Record<string, unknown> };
    const someRoleId = (listCapture.json().roles as Array<{ roleId: string }>)[0]?.roleId;
    expect(someRoleId).toBeTruthy();

    const detail = buildRouteCtx("GET", `/api/roles/${someRoleId}`);
    const handled = await handleRolesRoutes(detail);
    expect(handled).toBe(true);
    // @ts-expect-error capture attached for tests
    const detailCapture = detail.__capture as { status: number; json: () => Record<string, unknown> };
    expect(detailCapture.status).toBe(200);
    const role = detailCapture.json().role as { roleId: string };
    expect(role.roleId).toBe(someRoleId);
  });

  it("returns 404 for unknown role", async () => {
    const detail = buildRouteCtx("GET", "/api/roles/__missing__");
    const handled = await handleRolesRoutes(detail);
    expect(handled).toBe(true);
    // @ts-expect-error capture attached for tests
    const capture = detail.__capture as { status: number; json: () => Record<string, unknown> };
    expect(capture.status).toBe(404);
    const payload = capture.json();
    expect(payload.ok).toBe(false);
  });
});
