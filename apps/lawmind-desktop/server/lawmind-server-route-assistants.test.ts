import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleAssistantRoutes } from "./lawmind-server-route-assistants.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import { getAssistantById, upsertAssistant } from "../../../src/lawmind/assistants/store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  dirs.length = 0;
});

/**
 * 每个用例一棵**独立**临时树。
 *
 * 踩过的坑：`lawMindRoot = path.dirname(mkdtempSync(...))` 会落回共享的
 * `os.tmpdir()`，于是 `assistants.json` 跨用例、跨运行累积，助手名一路涨成
 * 「X 副本 3」——测试看似偶发，实际是互相污染，还会把临时目录写脏。
 * 这里让 workspace 与 LawMind 根都在同一棵 mkdtemp 树内。
 */
function tmpAssistantTree(): { workspaceDir: string; lawMindRoot: string; envFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-assistants-route-"));
  dirs.push(root);
  const workspaceDir = path.join(root, "ws");
  fs.mkdirSync(workspaceDir, { recursive: true });
  // resolveLawMindRoot 取 envFile 的 dirname，因此 envFile 放在 root 上即得到隔离的根。
  return { workspaceDir, lawMindRoot: root, envFile: path.join(root, ".env.lawmind") };
}

function jsonReq(method: string, payload: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(payload)));
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  });
  return req;
}

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

describe("lawmind-server-route-assistants", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await expect(
      handleAssistantRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });

  it("rejects invalid assistant ids on patch", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    const req = {
      method: "PATCH",
      headers: {},
    } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, handler: (...args: unknown[]) => void) {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ displayName: "Unsafe" })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();

    await expect(
      handleAssistantRoutes({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/assistants/%2Eevil"),
        pathname: "/api/assistants/%2Eevil",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, error: "invalid assistant id" });
  });

  it("rejects invalid assistant ids on create", async () => {
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
          handler(Buffer.from(JSON.stringify({ assistantId: ".evil", displayName: "Unsafe" })));
        }
        if (event === "end") {
          handler();
        }
        return this;
      },
    });
    const capture = createResponseCapture();

    await expect(
      handleAssistantRoutes({
        ctx,
        req,
        res: capture.res,
        url: new URL("http://127.0.0.1/api/assistants"),
        pathname: "/api/assistants",
        c: {},
      }),
    ).resolves.toBe(true);

    expect(capture.status).toBe(400);
    expect(capture.json()).toMatchObject({ ok: false, error: "invalid assistant id" });
  });
  it("PATCH persists the job brief instead of silently dropping it", async () => {
    // 回归：路由里字段是显式解构的，schema 与引擎支持 jobBrief 但路由漏了它时，
    // 律师在表单里写的边界会被静默丢弃——UI 看起来成功，实际什么都没存。
    const { workspaceDir: ws, lawMindRoot, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };

    const created = upsertAssistant(lawMindRoot, {
      displayName: "小陈",
      introduction: "助理",
      jobBrief: { responsibility: "盯续签" },
    });

    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("PATCH", {
        displayName: "小陈",
        jobBrief: { responsibility: "盯续签", prohibitions: "外发前必须问我" },
      }),
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/assistants/${created.assistantId}`),
      pathname: `/api/assistants/${created.assistantId}`,
      c: {},
    });

    expect(capture.status).toBe(200);
    const saved = getAssistantById(lawMindRoot, created.assistantId);
    expect(saved?.jobBrief?.prohibitions).toBe("外发前必须问我");
  });

  it("POST /api/assistants/:id/duplicate copies the role and its boundaries", async () => {
    const { workspaceDir: ws, lawMindRoot, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };
    const source = upsertAssistant(lawMindRoot, {
      displayName: "区域甲续签助手",
      introduction: "盯续签",
      customRoleInstructions: "按本所格式出稿。",
      jobBrief: { prohibitions: "外发前必须问我" },
    });

    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("POST", {}),
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/assistants/${source.assistantId}/duplicate`),
      pathname: `/api/assistants/${source.assistantId}/duplicate`,
      c: {},
    });

    expect(capture.status).toBe(200);
    const copy = (capture.json().assistant ?? {}) as Record<string, unknown>;
    expect(copy.assistantId).not.toBe(source.assistantId);
    expect(copy.displayName).toBe("区域甲续签助手 副本");
    expect(copy.jobBrief).toEqual({ prohibitions: "外发前必须问我" });
    expect(copy.customRoleInstructions).toBe("按本所格式出稿。");
  });

  it("accepts a duplicate with a new name, and an empty body", async () => {
    const { workspaceDir: ws, lawMindRoot, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };
    const source = upsertAssistant(lawMindRoot, {
      displayName: "区域甲续签助手",
      introduction: "盯续签",
    });

    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("POST", { displayName: "区域乙续签助手" }),
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/assistants/${source.assistantId}/duplicate`),
      pathname: `/api/assistants/${source.assistantId}/duplicate`,
      c: {},
    });
    expect(capture.status).toBe(200);
    expect((capture.json().assistant as Record<string, unknown>).displayName).toBe(
      "区域乙续签助手",
    );
  });

  it("rejects a duplicate of an unknown assistant", async () => {
    const { workspaceDir: ws, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };

    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("POST", {}),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/assistants/nope/duplicate"),
      pathname: "/api/assistants/nope/duplicate",
      c: {},
    });
    expect(capture.status).toBe(400);
    expect(String(capture.json().error)).toContain("助手不存在");
  });

  it("rejects an unsafe id on duplicate", async () => {
    const { workspaceDir: ws, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("POST", {}),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/assistants/%2Eevil/duplicate"),
      pathname: "/api/assistants/%2Eevil/duplicate",
      c: {},
    });
    expect(capture.status).toBe(400);
  });

  it("PATCH pins an assistant without rewriting the job brief", async () => {
    const { workspaceDir: ws, lawMindRoot, envFile } = tmpAssistantTree();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile,
      userEnvPath: envFile,
      policy: { loaded: false },
    };
    const created = upsertAssistant(lawMindRoot, {
      displayName: "续签助手",
      introduction: "盯到期",
      jobBrief: { prohibitions: "外发前必须问我" },
    });
    const capture = createResponseCapture();
    await handleAssistantRoutes({
      ctx,
      req: jsonReq("PATCH", { pinned: true, hidden: true }),
      res: capture.res,
      url: new URL(`http://127.0.0.1/api/assistants/${created.assistantId}`),
      pathname: `/api/assistants/${created.assistantId}`,
      c: {},
    });
    expect(capture.status).toBe(200);
    const saved = getAssistantById(lawMindRoot, created.assistantId);
    expect(saved?.pinned).toBe(true);
    expect(saved?.hidden).toBe(true);
    expect(saved?.jobBrief?.prohibitions).toBe("外发前必须问我");
  });
});
