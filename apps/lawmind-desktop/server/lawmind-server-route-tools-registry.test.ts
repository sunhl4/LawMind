import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleToolsRegistryRoute } from "./lawmind-server-route-tools-registry.js";
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
      return JSON.parse(body) as { ok?: boolean; tools?: Array<{ name: string }> };
    },
  };
}

describe("lawmind-server-route-tools-registry", () => {
  it("lists legal tools for GET /api/tools/registry", () => {
    const capture = createResponseCapture();
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "missing-env"),
      policy: { loaded: false },
    };
    const handled = handleToolsRegistryRoute({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/tools/registry"),
      pathname: "/api/tools/registry",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const body = capture.json();
    expect(body.ok).toBe(true);
    expect(body.tools?.some((t) => t.name === "search_matter")).toBe(true);
  });
});
