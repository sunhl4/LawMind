import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleChatRoute } from "./lawmind-server-route-chat.js";
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

describe("lawmind-server-route-chat", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleChatRoute({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("validates empty chat message", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const req = {
      method: "POST",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ message: "   " })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();

    await expect(
      handleChatRoute({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/chat"),
        pathname: "/api/chat",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({
      ok: false,
      code: "message_required",
    });
  });
});
