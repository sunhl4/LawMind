import fs from "node:fs/promises";
import type http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAutomation,
  getAutomationInboxItem,
  saveAutomationInboxItem,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import { handleAutomationsRoutes } from "./lawmind-server-route-automations.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function mockJsonReq(payload: unknown, method = "POST"): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "data") {
        handler(Buffer.from(JSON.stringify(payload)));
      }
      if (event === "end") {
        handler();
      }
      return this;
    },
  });
  return req;
}

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

describe("lawmind-server-route-automations", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-auto-route-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
    ctx = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false, policy: null },
    };
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("returns false for unrelated routes", async () => {
    const res = mockRes();
    const handled = await handleAutomationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/other"),
      pathname: "/api/other",
      c: {},
    });
    expect(handled).toBe(false);
  });

  it("GET /api/automations/presets lists presets", async () => {
    const res = mockRes();
    const handled = await handleAutomationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/automations/presets"),
      pathname: "/api/automations/presets",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, presets: expect.any(Array) });
    expect((res.body as { presets: unknown[] }).presets.length).toBeGreaterThan(0);
  });

  it("GET /api/automations lists automations and inbox", async () => {
    createAutomation(workspaceDir, {
      matterId: "matter-list",
      presetId: "renewal-monitor",
    });
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/automations"),
      pathname: "/api/automations",
      c: {},
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      automations: expect.any(Array),
      inbox: expect.any(Array),
    });
    expect((res.body as { automations: unknown[] }).automations.length).toBeGreaterThan(0);
  });

  it("POST /api/automations creates automation for valid matter", async () => {
    const res = mockRes();
    const handled = await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-auto-1",
        presetId: "renewal-monitor",
        schedule: { kind: "daily", hour: 9, minute: 0 },
      }),
      res,
      url: new URL("http://127.0.0.1/api/automations"),
      pathname: "/api/automations",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      automation: { matterId: "matter-auto-1", presetId: "renewal-monitor" },
    });
  });

  it("POST /api/automations rejects invalid matter id", async () => {
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ matterId: "../evil", presetId: "custom" }),
      res,
      url: new URL("http://127.0.0.1/api/automations"),
      pathname: "/api/automations",
      c: {},
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, code: "invalid_matter_id" });
  });

  it("POST /api/automations/from-instruction infers preset", async () => {
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-infer",
        instruction: "每天早上把邮箱里的合同附件拉下来做初审",
      }),
      res,
      url: new URL("http://127.0.0.1/api/automations/from-instruction"),
      pathname: "/api/automations/from-instruction",
      c: {},
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      inferred: expect.objectContaining({ presetId: "mail-contract-review" }),
    });
  });

  it("POST /api/automations/mail/seed is 403 by default (demo seeding gated)", async () => {
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ matterId: "matter-mail", subject: "x" }),
      res,
      url: new URL("http://127.0.0.1/api/automations/mail/seed"),
      pathname: "/api/automations/mail/seed",
      c: {},
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ ok: false, code: "mail_seed_disabled" });
  });

  it("POST /api/automations/mail/seed writes matter mail when LAWMIND_MAIL_SEED=1", async () => {
    vi.stubEnv("LAWMIND_MAIL_SEED", "1");
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({
        matterId: "matter-mail",
        subject: "合同修订稿",
        bodyText: "请查收",
      }),
      res,
      url: new URL("http://127.0.0.1/api/automations/mail/seed"),
      pathname: "/api/automations/mail/seed",
      c: {},
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, messageId: expect.any(String) });
    expect((res.body as { messages: unknown[] }).messages.length).toBeGreaterThan(0);
  });

  it("GET/PATCH/DELETE /api/automations/:id round-trip", async () => {
    const created = createAutomation(workspaceDir, {
      matterId: "matter-crud",
      presetId: "client-weekly-update",
      schedule: { kind: "weekly", weekday: 1, hour: 8, minute: 30 },
    });

    const getRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: getRes,
      url: new URL(`http://127.0.0.1/api/automations/${created.id}`),
      pathname: `/api/automations/${created.id}`,
      c: {},
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ ok: true, automation: { id: created.id } });

    const patchRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ enabled: false, title: "周报（暂停）" }, "PATCH"),
      res: patchRes,
      url: new URL(`http://127.0.0.1/api/automations/${created.id}`),
      pathname: `/api/automations/${created.id}`,
      c: {},
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({
      ok: true,
      automation: { enabled: false, title: "周报（暂停）" },
    });

    const delRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: { method: "DELETE" } as http.IncomingMessage,
      res: delRes,
      url: new URL(`http://127.0.0.1/api/automations/${created.id}`),
      pathname: `/api/automations/${created.id}`,
      c: {},
    });
    expect(delRes.status).toBe(200);

    const missRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res: missRes,
      url: new URL(`http://127.0.0.1/api/automations/${created.id}`),
      pathname: `/api/automations/${created.id}`,
      c: {},
    });
    expect(missRes.status).toBe(404);
  });

  it("POST inbox acknowledge and dismiss", async () => {
    const auto = createAutomation(workspaceDir, {
      matterId: "matter-inbox",
      presetId: "custom",
      title: "测试",
    });
    const inboxId = `inbox-${Date.now()}`;
    saveAutomationInboxItem(workspaceDir, {
      id: inboxId,
      automationId: auto.id,
      matterId: "matter-inbox",
      title: "待拍板",
      status: "open",
      summary: "待拍板",
      createdAt: new Date().toISOString(),
    });

    const ackRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ action: "acknowledge" }),
      res: ackRes,
      url: new URL(`http://127.0.0.1/api/automations/inbox/${inboxId}/action`),
      pathname: `/api/automations/inbox/${inboxId}/action`,
      c: {},
    });
    expect(ackRes.status).toBe(200);
    expect(getAutomationInboxItem(workspaceDir, inboxId)?.status).toBe("acknowledged");

    const inboxId2 = `inbox2-${Date.now()}`;
    saveAutomationInboxItem(workspaceDir, {
      id: inboxId2,
      automationId: auto.id,
      matterId: "matter-inbox",
      title: "可忽略",
      status: "open",
      summary: "可忽略",
      createdAt: new Date().toISOString(),
    });
    const dismissRes = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ action: "dismiss" }),
      res: dismissRes,
      url: new URL(`http://127.0.0.1/api/automations/inbox/${inboxId2}/action`),
      pathname: `/api/automations/inbox/${inboxId2}/action`,
      c: {},
    });
    expect(dismissRes.status).toBe(200);
    expect(getAutomationInboxItem(workspaceDir, inboxId2)?.status).toBe("dismissed");
  });

  it("POST approve_send without pendingSend returns 400", async () => {
    const auto = createAutomation(workspaceDir, {
      matterId: "matter-send",
      presetId: "custom",
    });
    const inboxId = `inbox-send-${Date.now()}`;
    saveAutomationInboxItem(workspaceDir, {
      id: inboxId,
      automationId: auto.id,
      matterId: "matter-send",
      title: "无待发",
      status: "open",
      summary: "无待发",
      createdAt: new Date().toISOString(),
    });
    const res = mockRes();
    await handleAutomationsRoutes({
      ctx,
      req: mockJsonReq({ action: "approve_send" }),
      res,
      url: new URL(`http://127.0.0.1/api/automations/inbox/${inboxId}/action`),
      pathname: `/api/automations/inbox/${inboxId}/action`,
      c: {},
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, code: "no_pending_send" });
  });
});
