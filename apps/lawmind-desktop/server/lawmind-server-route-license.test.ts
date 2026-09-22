import type http from "node:http";
import { describe, expect, it } from "vitest";
import { handleLicenseRoutes } from "./lawmind-server-route-license.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  let body = "";
  const res = {
    writeHead(s: number) {
      status = s;
      return res;
    },
    end(chunk?: string | Buffer) {
      body += chunk ? chunk.toString() : "";
      return res;
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

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...a: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
        handler(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  });
  return req;
}

function ctx(): LawmindRouteContext {
  return {} as LawmindRouteContext;
}

describe("license routes", () => {
  it("GET /api/license reports trial state without blocking", async () => {
    const cap = captureRes();
    const handled = await handleLicenseRoutes({
      pathname: "/api/license",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/license"),
      c: {},
      ...ctx(),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const license = cap.json().license as { status: string; blocking: boolean; message: string };
    // 同一台机器上二选一：首次运行为 trial，之后可能已过期。
    expect(["trial", "trial_expired", "licensed", "licensed_expired"]).toContain(license.status);
    expect(license.blocking).toBe(false);
    expect(license.message.length).toBeGreaterThan(0);
  });

  it("GET /api/license/fingerprint returns a stable opaque hash", async () => {
    const cap = captureRes();
    await handleLicenseRoutes({
      pathname: "/api/license/fingerprint",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/license/fingerprint"),
      c: {},
      ...ctx(),
    } as unknown as LawmindRouteContext);
    expect(cap.status).toBe(200);
    const fp = cap.json().fingerprint as string;
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("POST /api/license/activate rejects a forged code with 400", async () => {
    const cap = captureRes();
    await handleLicenseRoutes({
      pathname: "/api/license/activate",
      req: jsonReq("POST", { code: "AAAA.BBBB" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/license/activate"),
      c: {},
      ...ctx(),
    } as unknown as LawmindRouteContext);
    expect(cap.status).toBe(400);
    expect(cap.json().ok).toBe(false);
  });

  it("POST /api/license/activate requires a non-empty code", async () => {
    const cap = captureRes();
    await handleLicenseRoutes({
      pathname: "/api/license/activate",
      req: jsonReq("POST", { code: "" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/license/activate"),
      c: {},
      ...ctx(),
    } as unknown as LawmindRouteContext);
    expect(cap.status).toBe(400);
  });

  it("returns false for unrelated paths", async () => {
    const cap = captureRes();
    const handled = await handleLicenseRoutes({
      pathname: "/api/other",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/other"),
      c: {},
      ...ctx(),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(false);
  });
});
