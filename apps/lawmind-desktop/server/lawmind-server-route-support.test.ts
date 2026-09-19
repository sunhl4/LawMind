import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { handleSupportRoutes } from "./lawmind-server-route-support.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  const chunks: Buffer[] = [];
  const headers: Record<string, string> = {};
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      if (h) {
        Object.assign(headers, h);
      }
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return res;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    headers,
    get status() {
      return status;
    },
    buffer() {
      return Buffer.concat(chunks);
    },
    json() {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    },
  };
}

describe("support bundle route", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  function ctxFor(workspaceDir: string): LawmindRouteContext {
    return {
      ctx: {
        workspaceDir,
        envFile: undefined,
        userEnvPath: path.join(workspaceDir, ".env.lawmind"),
        policy: { loaded: false },
      } as unknown as LawmindRouteContext["ctx"],
      c: {},
    } as unknown as LawmindRouteContext;
  }

  it("previews the file list without downloading", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    const handled = await handleSupportRoutes({
      ...base,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle"),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const body = cap.json();
    const names = (body.files as Array<{ name: string }>).map((f) => f.name);
    expect(names).toContain("doctor.json");
    expect(names).toContain("scorecard.json");
    expect(String(body.note)).toContain("已脱敏");
  });

  it("downloads a zip whose entries are the redacted bundle files", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    await handleSupportRoutes({
      ...base,
      pathname: "/api/support/bundle",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/support/bundle?download=1"),
    } as unknown as LawmindRouteContext);
    expect(cap.status).toBe(200);
    expect(cap.headers["content-type"]).toBe("application/zip");
    const zip = await JSZip.loadAsync(cap.buffer());
    const names = Object.keys(zip.files).toSorted();
    expect(names).toEqual([
      "README.txt",
      "build.json",
      "doctor.json",
      "metrics.json",
      "scorecard.json",
    ]);
    const doctor = (await zip.file("doctor.json")?.async("string")) ?? "";
    expect(doctor).toContain("license");
    // 脱敏：不含密钥字段原文。
    expect(doctor).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it("returns false for other paths", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-support-"));
    dirs.push(ws);
    const cap = captureRes();
    const base = ctxFor(ws);
    const handled = await handleSupportRoutes({
      ...base,
      pathname: "/api/other",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/other"),
    } as unknown as LawmindRouteContext);
    expect(handled).toBe(false);
  });
});
