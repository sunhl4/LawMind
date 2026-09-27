import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emitPlatformGateSnapshot } from "../../../src/lawmind/platform/audit-gate.js";
import { handlePlatformRoutes } from "./lawmind-server-route-platform.js";
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

describe("lawmind-server-route-platform", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH;
  });

  it("GET /api/platform/gate-history returns recent snapshots", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-platform-route-"));
    tempDirs.push(ws);
    await emitPlatformGateSnapshot(path.join(ws, "audit"), {
      taskId: "draft-1",
      source: "review",
      actor: "lawyer",
      executionState: {
        phase: "approval",
        status: "awaiting_approval",
        recoverable: true,
      },
      gateDecisions: [{ gate: "approval_gate", decision: "awaiting_confirmation" }],
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
    const capture = createResponseCapture();
    const handled = await handlePlatformRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/platform/gate-history?limit=10"),
      pathname: "/api/platform/gate-history",
      c: {},
    });
    expect(handled).toBe(true);
    expect(capture.status).toBe(200);
    const payload = capture.json();
    expect(payload.ok).toBe(true);
    const items = payload.items as Array<{ taskId: string; source: string }>;
    expect(items.length).toBe(1);
    expect(items[0]?.taskId).toBe("draft-1");
    expect(items[0]?.source).toBe("review");
  });

  function makeCtx(ws: string): LawmindDispatchContext {
    return {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env.lawmind"),
      policy: { loaded: false },
    };
  }

  function readPolicy(ws: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(ws, "lawmind.policy.json"), "utf8"),
    ) as Record<string, unknown>;
  }

  function mockRequest(method: string, body?: Record<string, unknown>): http.IncomingMessage {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const req = {
      method,
      on(event: string, cb: (...args: unknown[]) => void) {
        const list = listeners.get(event) ?? [];
        list.push(cb);
        listeners.set(event, list);
        return req;
      },
      destroy() {},
    } as unknown as http.IncomingMessage;
    queueMicrotask(() => {
      const payload = body === undefined ? "" : JSON.stringify(body);
      for (const cb of listeners.get("data") ?? []) {
        cb(Buffer.from(payload, "utf8"));
      }
      for (const cb of listeners.get("end") ?? []) {
        cb();
      }
    });
    return req;
  }

  async function patchPolicy(ws: string, body: Record<string, unknown>) {
    const capture = createResponseCapture();
    const handled = await handlePlatformRoutes({
      ctx: makeCtx(ws),
      req: mockRequest("PATCH", body),
      res: capture.res,
      url: new URL("http://127.0.0.1/api/policy/workspace"),
      pathname: "/api/policy/workspace",
      c: {},
    });
    return { handled, capture };
  }

  it("PATCH 离线模式只写 egressMode，不抹掉 allowWebSearch", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-egress-route-"));
    tempDirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          allowWebSearch: true,
          productInsightsCollection: "local-only",
          networkAllowlist: ["npc.gov.cn"],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    // 打开离线：只应新增 egressMode，偏好字段原样保留。
    await patchPolicy(ws, { egressMode: "offline" });
    const after = readPolicy(ws);
    expect(after.egressMode).toBe("offline");
    expect(after.networkAllowlist).toEqual(["npc.gov.cn"]);
    expect(after.allowWebSearch).toBeUndefined();
    expect(after.productInsightsCollection).toBeUndefined();

    await patchPolicy(ws, { egressMode: "open" });
    const restored = readPolicy(ws);
    expect(restored.egressMode).toBe("open");
    expect(restored.allowWebSearch).toBeUndefined();
  });

  it("PATCH legacy highSecurityMode:false clears the pinned legacy key", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-egress-legacy-"));
    tempDirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, highSecurityMode: true, allowWebSearch: false }, null, 2)}\n`,
      "utf8",
    );

    const { capture } = await patchPolicy(ws, { highSecurityMode: false });
    expect(capture.json().highSecurityMode).toBe(false);
    const after = readPolicy(ws);
    // 旧键必须被清掉，否则 egressMode 推导仍会回到 offline。
    expect(after.highSecurityMode).toBeUndefined();
    expect(after.egressMode).toBeUndefined();
  });

  it("GET derives highSecurityMode from egressMode", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-egress-get-"));
    tempDirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, egressMode: "offline" }, null, 2)}\n`,
      "utf8",
    );
    const capture = createResponseCapture();
    await handlePlatformRoutes({
      ctx: makeCtx(ws),
      req: { method: "GET" } as http.IncomingMessage,
      res: capture.res,
      url: new URL("http://127.0.0.1/api/policy/workspace"),
      pathname: "/api/policy/workspace",
      c: {},
    });
    expect(capture.json()).toMatchObject({ ok: true, egressMode: "offline", highSecurityMode: true });
  });

  it("PATCH applies the policy to process env so the toggle works without a restart", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-egress-env-"));
    tempDirs.push(ws);
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      `${JSON.stringify({ schemaVersion: 1, egressMode: "allowlisted", allowWebSearch: true })}\n`,
      "utf8",
    );

    const on = await patchPolicy(ws, { egressMode: "offline" });
    expect(on.capture.json().webSearchForcedOff).toBe(true);
    // 运行时闸必须已生效，否则律师点了「离线」但当前会话照样联网。
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBe("1");

    const off = await patchPolicy(ws, { egressMode: "allowlisted" });
    expect(off.capture.json().webSearchForcedOff).toBe(false);
    expect(process.env.LAWMIND_POLICY_FORCE_NO_WEB_SEARCH).toBeUndefined();
  });

  it("PATCH stores a Word revision author and a blank clears it", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-rev-author-"));
    tempDirs.push(ws);

    const set = await patchPolicy(ws, { wordRevisionAuthor: "张律师" });
    expect(set.capture.status).toBe(200);
    expect(set.capture.json().wordRevisionAuthor).toBe("张律师");
    expect(readPolicy(ws).wordRevisionAuthor).toBe("张律师");

    const cleared = await patchPolicy(ws, { wordRevisionAuthor: "  " });
    expect(cleared.capture.status).toBe(200);
    expect(cleared.capture.json().wordRevisionAuthor).toBe("");
    expect(readPolicy(ws).wordRevisionAuthor).toBeUndefined();
  });
});
