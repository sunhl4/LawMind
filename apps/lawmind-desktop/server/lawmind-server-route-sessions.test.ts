import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginLiveTurnProgress,
  finishLiveTurnProgress,
  resetLiveTurnProgressStore,
} from "../../../src/lawmind/agent/live-turn-progress.js";
import { createSession, loadSession, saveSession } from "../../../src/lawmind/agent/session.js";
import { appendSessionEvent } from "../../../src/lawmind/agent/session-event-log.js";
import { isTurnAbortRequested, resetTurnAbortStore } from "../../../src/lawmind/agent/turn-abort.js";
import { handleSessionExtendedRoutes } from "./lawmind-server-route-sessions.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const stream = new PassThrough();
  if (body !== undefined) {
    stream.end(JSON.stringify(body), "utf8");
  } else {
    stream.end("{}", "utf8");
  }
  (stream as unknown as http.IncomingMessage).method = method;
  return stream as unknown as http.IncomingMessage;
}

function mockRes(): { res: http.ServerResponse; get: () => { status: number; raw: string } } {
  let status = 0;
  let raw = "";
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end(b: string) {
      raw = b;
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get: () => ({ status, raw }),
  };
}

describe("lawmind-server-route-sessions extended", () => {
  it("GET context-budget returns token snapshot", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-budget-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);

    let status = 0;
    let raw = "";
    const res = {
      writeHead(s: number) {
        status = s;
      },
      end(b: string) {
        raw = b;
      },
    } as unknown as http.ServerResponse;

    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };

    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/context-budget`),
      pathname: `/api/sessions/${session.sessionId}/context-budget`,
      c: {},
    });

    expect(handled).toBe(true);
    expect(status).toBe(200);
    const body = JSON.parse(raw) as {
      ok: boolean;
      used: number;
      effectiveLimit: number;
      level: string;
      modelId?: string;
      breakdown?: { buckets: Array<{ id: string; tokens: number }>; total: number };
      window?: { contextTokens: number; usableLimit: number; midTurnCompactLimit: number };
      compactCount?: number;
      lastCompact?: unknown;
      tuning?: {
        budget: { warnRatio: number; midTurnCompactTriggerRatio: number };
        midTurn: { maxPerTurn: number };
        carryover: { suggestMinCompacts: number };
      };
      tuningOverrides?: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.used).toBeGreaterThanOrEqual(0);
    expect(body.effectiveLimit).toBeGreaterThan(0);
    expect(["ok", "warn", "compact"]).toContain(body.level);
    // A3：分层用量（引擎给 { buckets, total }），各桶之和与 used 同口径。
    expect(body.breakdown?.buckets.length).toBeGreaterThan(0);
    expect(body.breakdown?.total).toBe(body.used);
    expect(body.breakdown?.buckets.reduce((n, b) => n + b.tokens, 0)).toBe(body.used);
    // A4：三元组齐全，回合内整理线 ≤ 可用窗口。
    expect(body.window?.usableLimit).toBe(body.effectiveLimit);
    expect(body.window?.midTurnCompactLimit).toBeGreaterThan(0);
    expect(body.window!.midTurnCompactLimit).toBeLessThanOrEqual(body.window!.usableLimit);
    expect(body.modelId).toBeTruthy();
    // A7：新会话还没压过。
    expect(body.compactCount).toBe(0);
    expect(body.lastCompact).toBeNull();
    // 高级设置可见性：生效调参 + 显式写过的键（没写策略文件 → 默认值、空 override）。
    expect(body.tuning?.budget.warnRatio).toBe(0.85);
    expect(body.tuning?.midTurn.maxPerTurn).toBe(3);
    expect(body.tuning?.carryover.suggestMinCompacts).toBe(2);
    expect(body.tuningOverrides).toEqual([]);
  });

  it("GET context-budget 报出生效调参与显式写过的策略键（tuning / tuningOverrides）", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-budget-tuning-"));
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({
        schemaVersion: 1,
        context: {
          warnRatio: 0.7,
          midTurnCompactTriggerRatio: 0.8,
          midTurn: { maxPerTurn: 5 },
          carryover: { suggestMinCompacts: 4 },
        },
      }),
      "utf8",
    );
    const session = createSession({ workspaceDir: ws, actorId: "lawyer", assistantId: "default" });
    saveSession(ws, session);

    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/context-budget`),
      pathname: `/api/sessions/${session.sessionId}/context-budget`,
      c: {},
    });
    expect(handled).toBe(true);
    const { status, raw } = get();
    expect(status).toBe(200);
    const body = JSON.parse(raw) as {
      tuning?: {
        budget: { warnRatio: number; midTurnCompactTriggerRatio: number };
        midTurn: { maxPerTurn: number };
        carryover: { suggestMinCompacts: number };
      };
      tuningOverrides?: string[];
    };
    expect(body.tuning?.budget.warnRatio).toBe(0.7);
    expect(body.tuning?.budget.midTurnCompactTriggerRatio).toBe(0.8);
    expect(body.tuning?.midTurn.maxPerTurn).toBe(5);
    expect(body.tuning?.carryover.suggestMinCompacts).toBe(4);
    // 画面上因此能说清「按哪套数字在跑」，而不只是「按默认」。
    expect(body.tuningOverrides).toEqual(
      expect.arrayContaining([
        "context.warnRatio",
        "context.midTurnCompactTriggerRatio",
        "context.midTurn.maxPerTurn",
        "context.carryover.suggestMinCompacts",
      ]),
    );
  });

  it("GET context-budget 按 ?modelId 解析窗口，并报出该会话压过几次", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-budget-model-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.matterId = "m-budget";
    session.conversationHistory.push(
      { role: "system", content: "sys", timestamp: new Date().toISOString() },
      { role: "user", content: "请审查违约金条款", timestamp: new Date().toISOString() },
    );
    session.lastCompactBoundary = {
      boundaryId: "b-1",
      at: "2026-09-23T02:10:00.000Z",
      droppedMessageCount: 12,
      midTurn: true,
      roundIndex: 2,
    };
    saveSession(ws, session);
    // 会话事件日志里的 compact_boundary 才是「压过几次」的事实源。
    appendSessionEvent(ws, session.sessionId, {
      type: "compact_boundary",
      boundaryId: "b-1",
      droppedMessageCount: 12,
      midTurn: true,
      roundIndex: 2,
    });

    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const res = mockRes();
    const pathname = `/api/sessions/${session.sessionId}/context-budget`;
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: res.res,
      url: new URL(`http://127.0.0.1${pathname}?modelId=builtin%3Aqwen-plus`),
      pathname,
      c: {},
    });

    expect(handled).toBe(true);
    expect(res.get().status).toBe(200);
    const body = JSON.parse(res.get().raw) as {
      modelId?: string;
      compactCount?: number;
      lastCompact?: { midTurn?: boolean; droppedMessageCount?: number } | null;
    };
    // 分母跟请求里点名的模型走（compose 里选中的那个）。
    expect(body.modelId).toContain("qwen-plus");
    expect(body.compactCount).toBe(1);
    expect(body.lastCompact?.midTurn).toBe(true);
    expect(body.lastCompact?.droppedMessageCount).toBe(12);
  });

  afterEach(() => {
    resetTurnAbortStore();
    resetLiveTurnProgressStore();
  });

  it("POST messages/mutate returns 409 while turn is running", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-mutate-busy-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
    );
    saveSession(ws, session);
    beginLiveTurnProgress(session.sessionId);

    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { uiIndex: 0, mode: "truncate" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/messages/mutate`),
      pathname: `/api/sessions/${session.sessionId}/messages/mutate`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(409);
    const body = JSON.parse(get().raw) as { ok: boolean; error: string };
    expect(body.error).toBe("turn_in_progress");
    finishLiveTurnProgress(session.sessionId, "completed");
  });

  it("POST messages/mutate delete_pair removes Q&A", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-mutate-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    session.conversationHistory.push(
      { role: "user", content: "q1", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a1", timestamp: new Date().toISOString() },
      { role: "user", content: "q2", timestamp: new Date().toISOString() },
      { role: "assistant", content: "a2", timestamp: new Date().toISOString() },
    );
    saveSession(ws, session);

    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { uiIndex: 0, mode: "delete_pair" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/messages/mutate`),
      pathname: `/api/sessions/${session.sessionId}/messages/mutate`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      messages: Array<{ role: string; text: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.messages.map((m) => m.text)).toEqual(["q2", "a2"]);
    const reloaded = loadSession(ws, session.sessionId);
    expect(reloaded?.conversationHistory.map((m) => m.content)).toEqual(["q2", "a2"]);
  });

  it("POST fork-with-carryover 注入续接种子并迁移闸门状态；待批准时 409 且不建新会话", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-fork-"));
    fs.writeFileSync(path.join(ws, "MEMORY.md"), "# 通用记忆\n", "utf8");
    const session = createSession({
      workspaceDir: ws,
      matterId: "m-fork",
      actorId: "lawyer",
      assistantId: "default",
      title: "竞业限制解除",
    });
    const now = new Date().toISOString();
    session.conversationHistory = [
      { role: "system", content: "sys", timestamp: now },
      { role: "user", content: "写竞业限制解除条款，依据《劳动合同法》第23条。", timestamp: now },
      { role: "assistant", content: "已定位第23条。", timestamp: now },
    ];
    session.pendingClarificationKeys = ["补偿标准"];
    saveSession(ws, session);

    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const pathname = `/api/sessions/${session.sessionId}/fork-with-carryover`;
    const { res, get } = mockRes();
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { useLlmDigest: false, clientNonce: "n-route" }),
      res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      sessionId: string;
      reused?: boolean;
      digestSource?: string;
      migrated?: { pendingClarificationKeys?: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.sessionId).not.toBe(session.sessionId);
    expect(body.reused).toBe(false);
    expect(body.digestSource).toBe("extractive");
    expect(body.migrated?.pendingClarificationKeys).toEqual(["补偿标准"]);

    const target = loadSession(ws, body.sessionId)!;
    expect(target.carriedOverFrom?.sessionId).toBe(session.sessionId);
    expect(target.conversationHistory[0]?.role).toBe("user");
    expect(target.conversationHistory[0]?.hiddenFromLawyer).toBe(true);
    expect(target.conversationHistory[0]?.content).toContain("【前序对话续接】");
    expect(target.conversationHistory[0]?.content).toContain("《劳动合同法》第23条");
    expect(target.title).toBe("竞业限制解除（承前）");
    expect(loadSession(ws, session.sessionId)?.forkedTo?.sessionId).toBe(body.sessionId);

    // 幂等：同一 nonce 复用，不再造第二份。
    const replay = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { useLlmDigest: false, clientNonce: "n-route" }),
      res: replay.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    const replayBody = JSON.parse(replay.get().raw) as { sessionId: string; reused?: boolean };
    expect(replayBody.reused).toBe(true);
    expect(replayBody.sessionId).toBe(body.sessionId);
    expect(fs.readdirSync(path.join(ws, "sessions")).filter((n) => n.endsWith(".json"))).toHaveLength(
      2,
    );

    // 待批准授权：409，且不产生新会话（授权不能跨会话搬）。
    const live = loadSession(ws, session.sessionId)!;
    live.forkedTo = undefined;
    live.pendingRequiresAction = [{ kind: "tool_approval", taskId: "t1" }] as never;
    saveSession(ws, live);
    const blocked = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { useLlmDigest: false }),
      res: blocked.res,
      url: new URL(`http://127.0.0.1${pathname}`),
      pathname,
      c: {},
    });
    expect(blocked.get().status).toBe(409);
    const blockedBody = JSON.parse(blocked.get().raw) as {
      code?: string;
      blockingActions?: string[];
    };
    expect(blockedBody.code).toBe("pending_authorization");
    expect(blockedBody.blockingActions).toEqual(["tool_approval"]);
    expect(fs.readdirSync(path.join(ws, "sessions")).filter((n) => n.endsWith(".json"))).toHaveLength(
      2,
    );
  });

  it("POST abort marks turn abort requested", async () => {    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-abort-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", {}),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/abort`),
      pathname: `/api/sessions/${session.sessionId}/abort`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    expect(isTurnAbortRequested(session.sessionId)).toBe(true);
  });

  it("PUT/GET/DELETE plan-handoff round-trips on session.json", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-plan-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const put = mockRes();
    expect(
      await handleSessionExtendedRoutes({
        ctx,
        req: jsonReq("PUT", { planText: "执行计划：先检索再起草" }),
        res: put.res,
        url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
        pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
        c: {},
      }),
    ).toBe(true);
    expect(put.get().status).toBe(200);
    const getRes = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: getRes.res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
      pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
      c: {},
    });
    const got = JSON.parse(getRes.get().raw) as {
      ok: boolean;
      planHandoff: { planText: string } | null;
    };
    expect(got.planHandoff?.planText).toContain("先检索");
    const del = mockRes();
    await handleSessionExtendedRoutes({
      ctx,
      req: { method: "DELETE" } as http.IncomingMessage,
      res: del.res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/plan-handoff`),
      pathname: `/api/sessions/${session.sessionId}/plan-handoff`,
      c: {},
    });
    expect(loadSession(ws, session.sessionId)?.planHandoff).toBeUndefined();
  });

  it("POST inject queues mid-turn pins on sidecar", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-inject-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", {
        contextPins: [{ pinKind: "file", root: "workspace", relPath: "cases/m1/a.docx", kind: "file" }],
      }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/inject`),
      pathname: `/api/sessions/${session.sessionId}/inject`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      pendingCount: number;
      inboxKind?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.pendingCount).toBe(1);
    expect(body.inboxKind).toBe("inject");
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.pending-pins.json`))).toBe(
      true,
    );
  });

  it("POST steer queues mid-turn notes on sidecar", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-sess-steer-"));
    const session = createSession({
      workspaceDir: ws,
      actorId: "lawyer",
      assistantId: "default",
    });
    saveSession(ws, session);
    const { res, get } = mockRes();
    const ctx: LawmindDispatchContext = {
      workspaceDir: ws,
      envFile: undefined,
      userEnvPath: path.join(ws, ".env"),
      policy: { loaded: false },
    };
    const handled = await handleSessionExtendedRoutes({
      ctx,
      req: jsonReq("POST", { text: "不要写结论，先对责任上限" }),
      res,
      url: new URL(`http://127.0.0.1/api/sessions/${session.sessionId}/steer`),
      pathname: `/api/sessions/${session.sessionId}/steer`,
      c: {},
    });
    expect(handled).toBe(true);
    expect(get().status).toBe(200);
    const body = JSON.parse(get().raw) as {
      ok: boolean;
      pendingCount: number;
      inboxKind?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.pendingCount).toBe(1);
    expect(body.inboxKind).toBe("steer");
    expect(fs.existsSync(path.join(ws, "sessions", `${session.sessionId}.pending-steer.json`))).toBe(
      true,
    );
  });
});
