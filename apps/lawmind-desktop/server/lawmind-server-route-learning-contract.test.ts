import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleLearningContractRoutes } from "./lawmind-server-route-learning-contract.js";
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

function createJsonRequest(method: string, pathname: string, body?: unknown): http.IncomingMessage {
  const req = {
    method,
    headers: {},
    url: pathname,
  } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data" && body !== undefined) {
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

describe("handleLearningContractRoutes", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    tempDirs.length = 0;
  });

  it("POST finalize creates pack and GET lists it", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-cr-api-"));
    tempDirs.push(workspaceDir);
    fs.writeFileSync(path.join(workspaceDir, "init.txt"), "init body", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "done.txt"), "final body", "utf8");

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const c: Record<string, string> = {};

    const postCap = createResponseCapture();
    const postReq = createJsonRequest("POST", "/api/learning/contract-revision/finalize", {
      initialPath: "init.txt",
      finalPath: "done.txt",
      keyModifications: ["责任上限"],
      title: "服务协议",
    });
    const postUrl = new URL("http://127.0.0.1/api/learning/contract-revision/finalize");
    const postHandled = await handleLearningContractRoutes({
      ctx,
      pathname: "/api/learning/contract-revision/finalize",
      req: postReq,
      res: postCap.res,
      url: postUrl,
      c,
    });
    expect(postHandled).toBe(true);
    expect(postCap.status).toBe(200);
    const postJson = postCap.json();
    expect(postJson.ok).toBe(true);
    expect(typeof postJson.revisionId).toBe("string");

    const getCap = createResponseCapture();
    const getReq = { method: "GET", headers: {}, url: "/api/learning/contract-revisions" } as http.IncomingMessage;
    Object.assign(getReq, {
      on() {
        return getReq;
      },
    });
    const getUrl = new URL("http://127.0.0.1/api/learning/contract-revisions");
    await handleLearningContractRoutes({
      ctx,
      pathname: "/api/learning/contract-revisions",
      req: getReq,
      res: getCap.res,
      url: getUrl,
      c,
    });
    const getJson = getCap.json();
    expect(getJson.ok).toBe(true);
    expect(Array.isArray(getJson.items)).toBe(true);
    expect((getJson.items as { title: string }[]).some((x) => x.title === "服务协议")).toBe(true);
  });

  it("POST finalize rejects path outside workspace", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-cr-out-"));
    tempDirs.push(workspaceDir);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-cr-evil-"));
    tempDirs.push(outside);
    fs.writeFileSync(path.join(outside, "x.txt"), "x", "utf8");

    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = createResponseCapture();
    const req = createJsonRequest("POST", "/api/learning/contract-revision/finalize", {
      initialPath: path.join(outside, "x.txt"),
      finalPath: path.join(outside, "x.txt"),
      keyModifications: [],
    });
    const handled = await handleLearningContractRoutes({
      ctx,
      pathname: "/api/learning/contract-revision/finalize",
      req,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/learning/contract-revision/finalize"),
      c: {},
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(403);
  });
});
