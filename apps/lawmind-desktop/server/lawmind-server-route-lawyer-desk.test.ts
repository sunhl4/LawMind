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
    const pulse = cap.json().pulse as { title: string; counts: { deadlines: number } };
    expect(pulse.title).toBe("脉搏案");
    expect(pulse.counts.deadlines).toBe(0);
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
});
