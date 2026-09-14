/**
 * @vitest-environment node
 */
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleIntentRoutes } from "./lawmind-server-route-intent.js";
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

function mockReq(body: unknown): http.IncomingMessage {
  const raw = JSON.stringify(body);
  const req = {
    method: "POST",
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === "data") {
        cb(Buffer.from(raw));
      }
      if (event === "end") {
        cb();
      }
      return req;
    },
  } as http.IncomingMessage;
  return req;
}

describe("lawmind-server-route-intent", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-intent-"));
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

  it("POST /api/intent/compile returns compiled capability for named contract file", async () => {
    const res = mockRes();
    const handled = await handleIntentRoutes({
      ctx,
      req: mockReq({
        instruction: "帮我看看",
        contextPins: [
          {
            pinKind: "file",
            root: "project",
            relPath: "买卖合同.docx",
            kind: "file",
          },
        ],
      }),
      res,
      url: new URL("http://127.0.0.1/api/intent/compile"),
      pathname: "/api/intent/compile",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      compiled: { capabilityId: "contract.review" },
    });
  });

  it("ignores other paths", async () => {
    const res = mockRes();
    expect(
      await handleIntentRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res,
        url: new URL("http://127.0.0.1/api/skills"),
        pathname: "/api/skills",
        c: {},
      }),
    ).toBe(false);
  });
});
