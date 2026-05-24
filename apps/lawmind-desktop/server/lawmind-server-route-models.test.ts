import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Models from "../../../src/lawmind/models/index.js";
import { handleModelsRoutes } from "./lawmind-server-route-models.js";

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

describe("lawmind-server-route-models", () => {
  let workspaceDir = "";
  let lawMindRoot = "";

  afterEach(() => {
    delete process.env.LAWMIND_QWEN_API_KEY;
    if (lawMindRoot && fs.existsSync(lawMindRoot)) {
      fs.rmSync(path.dirname(lawMindRoot), { recursive: true, force: true });
    }
  });

  it("GET /api/models lists builtins and custom rows", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-route-"));
    lawMindRoot = path.join(root, "LawMind");
    workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    process.env.LAWMIND_QWEN_API_KEY = "sk-x";

    const capture = createResponseCapture();
    const handled = await handleModelsRoutes({
      ctx: {
        workspaceDir,
        envFile: path.join(lawMindRoot, ".env.lawmind"),
        userEnvPath: path.join(lawMindRoot, ".env.lawmind"),
        policy: { loaded: false },
      },
      pathname: "/api/models",
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/models"),
      c: {},
    });

    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const models = payload.models as Array<{ id: string; configured: boolean }>;
    expect(models.some((m) => m.id === "builtin:qwen-plus" && m.configured)).toBe(true);
  });

  it("POST /api/models/test persists verification; GET exposes verifiedAt on catalog row", async () => {
    const probeSpy = vi.spyOn(Models, "probeAgentModel").mockResolvedValue({
      ok: true,
      latencyMs: 42,
      model: "qwen-plus",
      baseUrl: "https://dashscope.example/compatible-mode/v1",
    });
    try {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-models-verify-"));
      lawMindRoot = path.join(root, "LawMind");
      workspaceDir = path.join(lawMindRoot, "workspace");
      fs.mkdirSync(workspaceDir, { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");
      process.env.LAWMIND_QWEN_API_KEY = "sk-route-verify";

      const ctxBase = {
        workspaceDir,
        envFile: path.join(lawMindRoot, ".env.lawmind"),
        userEnvPath: path.join(lawMindRoot, ".env.lawmind"),
        policy: { loaded: false },
      };

      const testCap = createResponseCapture();
      const handledTest = await handleModelsRoutes({
        ctx: ctxBase,
        pathname: "/api/models/test",
        req: jsonPostReq({ modelId: "builtin:qwen-plus" }),
        res: testCap.res,
        url: new URL("http://127.0.0.1/api/models/test"),
        c: {},
      });
      expect(handledTest).toBe(true);
      expect(testCap.status).toBe(200);
      const tested = testCap.json() as {
        ok?: boolean;
        verifiedAt?: string;
        modelId?: string;
      };
      expect(tested.ok).toBe(true);
      expect(typeof tested.verifiedAt).toBe("string");
      expect(tested.modelId).toBe("builtin:qwen-plus");

      const getCap = createResponseCapture();
      await handleModelsRoutes({
        ctx: ctxBase,
        pathname: "/api/models",
        req: { method: "GET" } as http.IncomingMessage,
        res: getCap.res,
        url: new URL("http://127.0.0.1/api/models"),
        c: {},
      });
      expect(getCap.status).toBe(200);
      const payload = getCap.json() as {
        models?: Array<{ id: string; verifiedAt?: string; verifiedLatencyMs?: number }>;
      };
      const row = payload.models?.find((m) => m.id === "builtin:qwen-plus");
      expect(row?.verifiedAt).toBe(tested.verifiedAt);
      expect(row?.verifiedLatencyMs).toBe(42);
    } finally {
      probeSpy.mockRestore();
    }
  });

  it("PATCH /api/models/draft-with-model toggles preference", async () => {
    process.env.LAWMIND_QWEN_API_KEY = "sk-test";
    const ctxBase = {
      workspaceDir,
      envFile: path.join(lawMindRoot, ".env.lawmind"),
      userEnvPath: path.join(lawMindRoot, ".env.lawmind"),
      policy: { loaded: false },
    };

    const enableCap = createResponseCapture();
    const handledEnable = await handleModelsRoutes({
      ctx: ctxBase,
      pathname: "/api/models/draft-with-model",
      req: jsonPatchReq({ enabled: true }),
      res: enableCap.res,
      url: new URL("http://127.0.0.1/api/models/draft-with-model"),
      c: {},
    });
    expect(handledEnable).toBe(true);
    expect(enableCap.status).toBe(200);
    const enabled = enableCap.json() as { draftWithModelEnabled?: boolean };
    expect(enabled.draftWithModelEnabled).toBe(true);

    const getCap = createResponseCapture();
    await handleModelsRoutes({
      ctx: ctxBase,
      pathname: "/api/models",
      req: { method: "GET" } as http.IncomingMessage,
      res: getCap.res,
      url: new URL("http://127.0.0.1/api/models"),
      c: {},
    });
    const payload = getCap.json() as { draftWithModelEnabled?: boolean };
    expect(payload.draftWithModelEnabled).toBe(true);
  });
});

function jsonPostReq(body: unknown): http.IncomingMessage {
  return jsonBodyReq("POST", body);
}

function jsonPatchReq(body: unknown): http.IncomingMessage {
  return jsonBodyReq("PATCH", body);
}

function jsonBodyReq(method: string, body: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
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
