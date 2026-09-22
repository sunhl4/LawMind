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

  /**
   * 旧式文件 pin（**不带 `pinKind`**）仍被接受，且编译结果与新形状一致。
   *
   * ⚠️ 这条是**容忍性回归锁**，不是「归一化修复」的证明。写清楚免得后人误读：
   * 请求体允许两种形状（`contextPinsRequestSchema` = 新形状 ∪ 旧文件形状），
   * 而 `compileTurnIntent` 的入参类型只要新形状（`ComposeContextPin[]`）。
   * 路由现在**先归一**再传（满足被调用方的声明），但下游
   * （`peek-pinned-documents.ts` / `compile-intent.ts`）本来就用
   * `"relPath" in pin` 这种鸭子类型判断，**对旧形状本来也容得下** ——
   * 所以这个改动是**类型契约修复，未证明有用户可见行为变化**。
   *
   * 两者唯一可能的语义差异是 `peekPinnedDocuments` 的 `preferredRoot`
   * （旧形状没有 `pinKind` 时取不到 root）；当同一相对路径在 workspace 与 project
   * 下**同时存在**时才会显出差别。本用例的夹具里文件并不存在，故**测不到**那一点。
   * 有真项目目录时值得再补一条会区分 root 的用例。
   */
  it("旧式文件 pin（无 pinKind）仍被接受，编译结果与新形状一致", async () => {
    const legacy = mockRes();
    await handleIntentRoutes({
      ctx,
      req: mockReq({
        instruction: "帮我看看",
        // 旧形状：没有 pinKind
        contextPins: [{ root: "project", relPath: "买卖合同.docx", kind: "file" }],
      }),
      res: legacy,
      url: new URL("http://127.0.0.1/api/intent/compile"),
      pathname: "/api/intent/compile",
      c: {},
    });
    expect(legacy.status).toBe(200);
    expect(legacy.body).toMatchObject({ ok: true, compiled: { capabilityId: "contract.review" } });

    const modern = mockRes();
    await handleIntentRoutes({
      ctx,
      req: mockReq({
        instruction: "帮我看看",
        contextPins: [
          { pinKind: "file", root: "project", relPath: "买卖合同.docx", kind: "file" },
        ],
      }),
      res: modern,
      url: new URL("http://127.0.0.1/api/intent/compile"),
      pathname: "/api/intent/compile",
      c: {},
    });
    expect(legacy.body).toEqual(modern.body);
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
