import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleHealthRoute } from "./lawmind-server-route-health.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function createResponseCapture() {
  let status = 0;
  let headers: Record<string, string> = {};
  let body = "";
  const res = {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
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
    get headers() {
      return headers;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

describe("lawmind-server-route-health", () => {
  const prevRepoRoot = process.env.LAWMIND_REPO_ROOT;

  afterEach(() => {
    if (prevRepoRoot === undefined) {
      delete process.env.LAWMIND_REPO_ROOT;
    } else {
      process.env.LAWMIND_REPO_ROOT = prevRepoRoot;
    }
  });

  it("returns false for non-health routes", () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    const handled = handleHealthRoute({
      ctx,
      req: { method: "POST" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/other"),
      pathname: "/api/other",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("returns health payload for GET /api/health", () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-health-route-"));
    const userEnvPath = path.join(workspaceDir, ".env.lawmind");
    fs.writeFileSync(userEnvPath, "LAWMIND_AGENT_MODEL=test-model\n", "utf8");
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: userEnvPath,
      userEnvPath,
      policy: { loaded: false },
    };

    const handled = handleHealthRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/health"),
      pathname: "/api/health",
      c: { "x-test": "1" },
    });

    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    expect(capture.headers["x-test"]).toBe("1");
    expect(capture.json()).toMatchObject({
      ok: true,
      workspaceDir,
      envHint: {
        userDataEnvPath: userEnvPath,
        userDataEnvExists: true,
      },
    });
  });
});
