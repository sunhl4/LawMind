import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { handleFilesystemRoute } from "./lawmind-server-route-fs.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockRes(): http.ServerResponse & { body?: unknown; status?: number } {
  const res = {
    status: 200,
    body: undefined as unknown,
    writeHead(code: number) {
      this.status = code;
    },
    end(payload?: string | Buffer) {
      if (typeof payload === "string") {
        this.body = JSON.parse(payload);
      }
    },
  } as http.ServerResponse & { body?: unknown; status?: number };
  return res;
}

describe("lawmind-server-route-fs", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-fs-route-"));
    await fs.mkdir(path.join(workspaceDir, "artifacts"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "artifacts", "demo.txt"), "hello", "utf8");
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("returns 404 for missing artifact", async () => {
    const req = { method: "GET" } as http.IncomingMessage;
    const res = mockRes();
    const handled = await handleFilesystemRoute({
      ctx,
      req,
      res,
      url: new URL("http://127.0.0.1/api/artifact?path=missing.txt"),
      pathname: "/api/artifact",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(404);
  });
});
