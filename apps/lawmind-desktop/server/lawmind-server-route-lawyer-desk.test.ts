import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMatterIfMissing } from "../../../src/lawmind/application/services/matter-write-service.js";
import { handleLawyerDeskRoutes } from "./lawmind-server-route-lawyer-desk.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      if (h) {
        Object.assign(headers, h);
      }
      return res;
    },
    end(c?: string | Buffer) {
      body += c ? c.toString() : "";
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    json() {
      return JSON.parse(body) as Record<string, unknown>;
    },
  };
}

function jsonReq(method: string, body?: unknown): http.IncomingMessage {
  const req = { method, headers: {} } as http.IncomingMessage;
  Object.assign(req, {
    on(ev: string, fn: (...a: unknown[]) => void) {
      if (ev === "data" && body !== undefined) {
        fn(Buffer.from(JSON.stringify(body)));
      }
      if (ev === "end") {
        fn();
      }
      return req;
    },
  });
  return req;
}

describe("handleLawyerDeskRoutes", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const d of tmp) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
    tmp.length = 0;
  });

  it("extracts a summons then confirms a hearing deadline", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-api-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-a", title: "借贷案", matterKind: "litigation" });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const extract = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/desk/events/extract",
      req: jsonReq("POST", {
        text: "传票：请于2026年9月15日9时到第三法庭开庭。案号（2026）京0105民初88号。",
      }),
      res: extract.res,
      url: new URL("http://127.0.0.1/api/desk/events/extract"),
      c: {},
    });
    expect(extract.status).toBe(200);
    const events = extract.json().events as Array<{ eventKind: string; dueAt?: string; title: string }>;
    expect(events.some((e) => e.eventKind === "hearing")).toBe(true);
    const hearing = events.find((e) => e.eventKind === "hearing");
    const confirm = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/desk/events/confirm",
      req: jsonReq("POST", {
        matterId: "case-a",
        events: [{ eventKind: "hearing", title: hearing?.title ?? "开庭", dueAt: hearing?.dueAt ?? "2026-09-15T01:00:00.000Z" }],
      }),
      res: confirm.res,
      url: new URL("http://127.0.0.1/api/desk/events/confirm"),
      c: {},
    });
    expect(confirm.json().ok).toBe(true);

    const ics = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/matters/case-a/deadlines.ics",
      req: jsonReq("GET"),
      res: ics.res,
      url: new URL("http://127.0.0.1/api/matters/case-a/deadlines.ics"),
      c: {},
    });
    expect(ics.body).toContain("BEGIN:VCALENDAR");
    expect(ics.body).toContain("SUMMARY:");
  });

  it("chains 上诉期 to 开庭 when confirming a mixed extract batch", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-chain-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-chain", title: "上诉案", matterKind: "litigation" });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const confirm = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/desk/events/confirm",
      req: jsonReq("POST", {
        matterId: "case-chain",
        events: [
          { eventKind: "limitation", title: "上诉期限", dueAt: "2026-10-01T01:00:00.000Z" },
          { eventKind: "hearing", title: "开庭", dueAt: "2026-09-15T01:00:00.000Z" },
          { eventKind: "filing", title: "举证期限", dueAt: "2026-09-10T01:00:00.000Z" },
        ],
      }),
      res: confirm.res,
      url: new URL("http://127.0.0.1/api/desk/events/confirm"),
      c: {},
    });
    const deadlines = confirm.json().deadlines as Array<{
      title: string;
      dependsOnDeadlineId?: string;
      deadlineId: string;
    }>;
    const hearing = deadlines.find((d) => d.title === "开庭");
    const appeal = deadlines.find((d) => d.title === "上诉期限");
    const evidence = deadlines.find((d) => d.title === "举证期限");
    expect(appeal?.dependsOnDeadlineId).toBe(hearing?.deadlineId);
    expect(evidence?.dependsOnDeadlineId).toBeUndefined();

    const list = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/matters/case-chain/deadlines",
      req: jsonReq("GET"),
      res: list.res,
      url: new URL("http://127.0.0.1/api/matters/case-chain/deadlines"),
      c: {},
    });
    const desk = list.json().deadlines as Array<{
      title: string;
      released: boolean;
      waitingOnTitle?: string;
      sourceLabel: string;
    }>;
    expect(desk.find((d) => d.title === "上诉期限")).toMatchObject({
      released: false,
      waitingOnTitle: "开庭",
      sourceLabel: "传票抽取",
    });
  });

  it("compiles talk into an intake brief", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-talk-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-b", title: "谈话案" });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/matters/case-b/intake-brief",
      req: jsonReq("POST", {
        transcript: "客户希望把拖欠工资要回来，公司把他开除了。有聊天记录。",
      }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/case-b/intake-brief"),
      c: {},
    });
    expect(cap.json().ok).toBe(true);
    const brief = cap.json().brief as { causeCandidates: Array<{ label: string }>; clientNeeds: string[] };
    expect(brief.causeCandidates.length).toBeGreaterThan(0);
    expect(brief.clientNeeds.length).toBeGreaterThan(0);
  });

  it("returns a matter pulse for the desk file", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-pulse-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-c", title: "脉搏案", matterKind: "litigation" });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/matters/case-c/pulse",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/case-c/pulse"),
      c: {},
    });
    expect(cap.json().ok).toBe(true);
    const pulse = cap.json().pulse as {
      title: string;
      counts: { deadlines: number };
      timeline: unknown[];
      materials: unknown[];
    };
    expect(pulse.title).toBe("脉搏案");
    expect(pulse.counts.deadlines).toBe(0);
    expect(Array.isArray(pulse.timeline)).toBe(true);
    expect(pulse.materials).toEqual([]);
  });

  it("pulse rematerializes matter.json when only cases/<id> exists", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-pulse-cases-"));
    tmp.push(workspaceDir);
    fs.mkdirSync(path.join(workspaceDir, "cases", "YX-mail", "mail"), { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, "cases", "YX-mail", "CASE.md"), "# 邮件案\n", "utf8");
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/matters/YX-mail/pulse",
      req: jsonReq("GET"),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/YX-mail/pulse"),
      c: {},
    });
    expect(cap.status).toBe(200);
    expect(cap.json().ok).toBe(true);
    expect((cap.json().pulse as { matterId: string }).matterId).toBe("YX-mail");
    expect(fs.existsSync(path.join(workspaceDir, "matters", "YX-mail", "matter.json"))).toBe(true);
  });

  it("marks a mail source as done in today's plan", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-mail-done-"));
    tmp.push(workspaceDir);
    const { localDateKey, saveDailyPlan } = await import("../../../src/lawmind/desk/daily-plan.js");
    const date = localDateKey();
    await saveDailyPlan(workspaceDir, {
      date,
      items: [
        {
          id: "p-mail",
          text: "回催稿",
          done: false,
          source: "mail",
          sourceRef: "msg-1",
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const cap = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/desk/plan/source-done",
      req: jsonReq("POST", { source: "mail", sourceRef: "msg-1" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/desk/plan/source-done"),
      c: {},
    });
    expect(cap.json().ok).toBe(true);
    const plan = cap.json().plan as { items: Array<{ sourceRef?: string; done: boolean }> };
    expect(plan.items.find((item) => item.sourceRef === "msg-1")?.done).toBe(true);
  });

  it("returns carried yesterday plans and completes them on the origin date", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-carry-"));
    tmp.push(workspaceDir);
    const { appendDailyPlanItems, loadDailyPlan, localDateKey, shiftLocalDateKey } = await import(
      "../../../src/lawmind/desk/daily-plan.js"
    );
    const today = localDateKey();
    const yesterday = shiftLocalDateKey(today, -1);
    const saved = await appendDailyPlanItems(workspaceDir, ["改代理词"], { date: yesterday });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };

    const todayRes = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: "/api/desk/today",
      req: jsonReq("GET"),
      res: todayRes.res,
      url: new URL("http://127.0.0.1/api/desk/today"),
      c: {},
    });
    expect(todayRes.json().ok).toBe(true);
    const snapshot = todayRes.json().today as {
      items: Array<{ id: string; title: string; originDate?: string }>;
    };
    const carried = snapshot.items.find((item) => item.title === "改代理词");
    expect(carried?.originDate).toBe(yesterday);

    const patch = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: `/api/desk/plan/items/${saved.items[0].id}`,
      req: jsonReq("PATCH", { done: true, date: yesterday }),
      res: patch.res,
      url: new URL(`http://127.0.0.1/api/desk/plan/items/${saved.items[0].id}`),
      c: {},
    });
    expect(patch.json().ok).toBe(true);
    expect(loadDailyPlan(workspaceDir, yesterday).items[0]?.done).toBe(true);
    expect(loadDailyPlan(workspaceDir, today).items).toHaveLength(0);
    const after = (patch.json().today as { items: Array<{ title: string }> }).items;
    expect(after.some((item) => item.title === "改代理词")).toBe(false);
  });

  it("patches matterId onto a plan item", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-plan-link-"));
    tmp.push(workspaceDir);
    const { appendDailyPlanItems, loadDailyPlan, localDateKey } = await import(
      "../../../src/lawmind/desk/daily-plan.js"
    );
    const today = localDateKey();
    const saved = await appendDailyPlanItems(workspaceDir, ["回电王总"], { date: today });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const patch = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: `/api/desk/plan/items/${saved.items[0].id}`,
      req: jsonReq("PATCH", { matterId: "case-link" }),
      res: patch.res,
      url: new URL(`http://127.0.0.1/api/desk/plan/items/${saved.items[0].id}`),
      c: {},
    });
    expect(patch.json().ok).toBe(true);
    expect(loadDailyPlan(workspaceDir, today).items[0]?.matterId).toBe("case-link");
  });

  it("deletes a plan item from today's reminder", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-plan-del-"));
    tmp.push(workspaceDir);
    const { appendDailyPlanItems, loadDailyPlan, localDateKey } = await import(
      "../../../src/lawmind/desk/daily-plan.js"
    );
    const today = localDateKey();
    const saved = await appendDailyPlanItems(workspaceDir, ["过时备忘"], { date: today });
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const del = captureRes();
    await handleLawyerDeskRoutes({
      ctx,
      pathname: `/api/desk/plan/items/${saved.items[0].id}/delete`,
      req: jsonReq("POST", {}),
      res: del.res,
      url: new URL(`http://127.0.0.1/api/desk/plan/items/${saved.items[0].id}/delete`),
      c: {},
    });
    expect(del.json().ok).toBe(true);
    expect(loadDailyPlan(workspaceDir, today).items).toHaveLength(0);
    const todayItems = (del.json().today as { items: Array<{ title: string }> }).items;
    expect(todayItems.some((item) => item.title === "过时备忘")).toBe(false);
  });

  /**
   * `/api/workspace/standards` 的 `bindWhen.contractTypes` 必须是**闭合的 12 类 id**。
   *
   * 为什么值得单独锁：`user-standards.ts` 的 `parseBindWhen()` 会把未知 id **静默过滤**——
   * 那条容忍属于读路径（文件可能被手工编辑）。写路径容忍任意字符串的后果是：
   * 律师填个中文标签（如「买卖合同」）→ 落盘时被丢掉 → 这条标准**永不命中任何案件**，
   * 且没有任何提示。宁可 400，也不要存一条哑标准。
   */
  it("标准绑定的合同类型只收闭合 id；中文标签等未知取值 400", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-std-"));
    tmp.push(workspaceDir);
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    const save = (body: unknown) => {
      const capture = captureRes();
      const done = handleLawyerDeskRoutes({
        ctx,
        req: jsonReq("POST", body),
        res: capture.res,
        url: new URL("http://127.0.0.1/api/workspace/standards"),
        pathname: "/api/workspace/standards",
        c: {},
      }).then(() => capture.status);
      return done;
    };

    const base = {
      title: "买卖合同必查",
      kind: "contract_review" as const,
      items: [{ text: "核对交付期限" }],
    };

    // 合法：闭合 id（`sale` 在 CLOSED_CONTRACT_TYPE_IDS 里）
    expect(await save({ ...base, bindWhen: { contractTypes: ["sale"] } })).toBe(200);

    // 非法：中文标签 / 拼错的 id / 大小写不符 —— 必须显式拒绝，而不是默默丢掉
    for (const bad of [["买卖合同"], ["salee"], ["SALE"]]) {
      expect(await save({ ...base, bindWhen: { contractTypes: bad } }), `contractTypes=${JSON.stringify(bad)} 必须被拒`).toBe(400);
    }
  });

  it("precedents route is honestly off without the cross-matter flag", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-desk-prec-"));
    tmp.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "case-p", title: "借贷案" });
    const prev = process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
    const ctx: LawmindDispatchContext = {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
    try {
      const res = captureRes();
      await handleLawyerDeskRoutes({
        ctx,
        pathname: "/api/matters/case-p/precedents",
        req: jsonReq("GET"),
        res: res.res,
        url: new URL("http://127.0.0.1/api/matters/case-p/precedents"),
        c: {},
      });
      expect(res.status).toBe(200);
      const body = res.json() as { ok: boolean; enabled: boolean; hits: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.enabled).toBe(false);
      expect(body.hits).toEqual([]);
    } finally {
      if (prev === undefined) {
        delete process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH;
      } else {
        process.env.LAWMIND_ALLOW_CROSS_MATTER_SEARCH = prev;
      }
    }
  });
});
