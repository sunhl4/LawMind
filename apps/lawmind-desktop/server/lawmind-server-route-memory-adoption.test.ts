import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { handleMemoryAdoptionRoutes } from "./lawmind-server-route-memory-adoption.js";
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

function mockPostReq(body: unknown): http.IncomingMessage {
  const req = { method: "POST", headers: {} } as http.IncomingMessage;
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

describe("lawmind-server-route-memory-adoption", () => {
  let workspaceDir: string;
  let ctx: LawmindDispatchContext;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join("/tmp", "lawmind-memory-adoption-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
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

  it("GET /api/memory/adoption lists suggestions", async () => {
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: { method: "GET" } as http.IncomingMessage,
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption"),
      pathname: "/api/memory/adoption",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, items: expect.any(Array) });
  });

  it("POST /api/memory/adoption/suggest returns 400 without body", async () => {
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq(null),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/suggest"),
      pathname: "/api/memory/adoption/suggest",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(400);
  });

  it("POST /api/memory/adoption/adopt writes case.progress to session-summary", async () => {
    const { suggestMemoryAdoption } = await import(
      "../../../src/lawmind/memory/adoption-service.js"
    );
    const rec = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      {
        scope: "matter",
        kind: "case.progress",
        targetId: "matter-adopt",
        payload: "### 沉淀\n\n律师：请记住对方主张适用仲裁。",
        origin: "agent",
      },
      { autoAdopt: false },
    );
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ id: rec.id }),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt"),
      pathname: "/api/memory/adoption/adopt",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const summary = await fs.readFile(
      path.join(workspaceDir, "cases", "matter-adopt", "session-summary.md"),
      "utf8",
    );
    expect(summary).toContain("仲裁");
  });

  it("POST /api/memory/adoption/adopt 对无落盘面 kind 返回 recorded_noop（不宣称已生效）", async () => {
    const { suggestMemoryAdoption } = await import(
      "../../../src/lawmind/memory/adoption-service.js"
    );
    const rec = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      {
        scope: "project",
        kind: "project.note",
        payload: "项目级备注",
        origin: "lawyer",
      },
      { autoAdopt: false },
    );
    const res = mockRes();
    const handled = await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ id: rec.id }),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt"),
      pathname: "/api/memory/adoption/adopt",
      c: {},
    });
    expect(handled).toBe(true);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, record: { state: "recorded_noop" } });
    const record = (res.body as { record?: { noopReason?: string } }).record;
    expect(record?.noopReason).toBeTruthy();
  });

  it("POST /api/memory/adoption/adopt-batch 预览零写入，确认后一次采纳多条", async () => {
    const { suggestMemoryAdoption, listMemorySuggestions } = await import(
      "../../../src/lawmind/memory/adoption-service.js"
    );
    const a = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      { scope: "firm", kind: "firm.preference", payload: "所内惯例：先票后款", origin: "engine" },
      { autoAdopt: false },
    );
    const b = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      { scope: "playbook", kind: "playbook.clause_learning", payload: "惯用条款：不可抗力", origin: "engine" },
      { autoAdopt: false },
    );

    // 1) dryRun：只回预览
    const previewRes = mockRes();
    await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ ids: [a.id, b.id], dryRun: true }),
      res: previewRes,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt-batch"),
      pathname: "/api/memory/adoption/adopt-batch",
      c: {},
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.body).toMatchObject({ ok: true, applied: false });
    const preview = previewRes.body as { plan: { items: Array<{ id: string }> } };
    expect(preview.plan.items.map((i) => i.id)).toEqual([a.id, b.id]);
    const untouched = await listMemorySuggestions(workspaceDir);
    expect(untouched.every((r) => r.state === "pending")).toBe(true);

    // 2) 确认：一次落盘多条
    const commitRes = mockRes();
    await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ ids: [a.id, b.id], dryRun: false }),
      res: commitRes,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt-batch"),
      pathname: "/api/memory/adoption/adopt-batch",
      c: {},
    });
    expect(commitRes.status).toBe(200);
    expect(commitRes.body).toMatchObject({ ok: true, applied: true });
    const committed = commitRes.body as { result: { adopted: string[] } };
    expect(committed.result.adopted).toEqual([a.id, b.id]);
    const after = await listMemorySuggestions(workspaceDir);
    for (const id of [a.id, b.id]) {
      const row = after.find((r) => r.id === id);
      expect(row?.state === "adopted" || row?.state === "recorded_noop").toBe(true);
    }
  });

  it("POST /api/memory/adoption/adopt-batch 的 low_risk_style 只取低风险风格项", async () => {
    const { suggestMemoryAdoption } = await import(
      "../../../src/lawmind/memory/adoption-service.js"
    );
    const style = await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      { scope: "lawyer", kind: "lawyer.profile_learning", payload: "风格：结论前置", origin: "engine" },
      { autoAdopt: false },
    );
    await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      { scope: "matter", kind: "case.core_issue", targetId: "m-1", payload: "争点：付款条件", origin: "engine" },
      { autoAdopt: false },
    );

    const res = mockRes();
    await handleMemoryAdoptionRoutes({
      ctx,
      req: mockPostReq({ mode: "low_risk_style", dryRun: true }),
      res,
      url: new URL("http://127.0.0.1/api/memory/adoption/adopt-batch"),
      pathname: "/api/memory/adoption/adopt-batch",
      c: {},
    });
    const body = res.body as { plan: { items: Array<{ id: string; lowRiskStyle: boolean }> } };
    expect(body.plan.items.map((i) => i.id)).toEqual([style.id]);
    expect(body.plan.items[0]?.lowRiskStyle).toBe(true);
  });
});
