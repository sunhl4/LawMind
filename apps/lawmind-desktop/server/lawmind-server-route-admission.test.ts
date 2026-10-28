/**
 * P1.1 收案记录 HTTP 边界：桌面端能读、能推进，但接受/婉拒仍由律师动作触发。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleMailRoutes } from "./lawmind-server-route-mail.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import {
  createMatterIfMissing,
  updateMatterProfile,
} from "../../../src/lawmind/application/services/matter-write-service.js";
import { createAdmission } from "../../../src/lawmind/intake/admission.js";
import { recordIntakeItem } from "../../../src/lawmind/intake/store.js";
import { listDeadlinesForMatter } from "../../../src/lawmind/application/services/deadline-service.js";

describe("lawmind-server-route-mail admission routes", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function workspace(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-admission-route-"));
    dirs.push(dir);
    return dir;
  }

  function response() {
    let status = 0;
    let body = "";
    const res = {
      writeHead(next: number) {
        status = next;
      },
      end(value?: string | Buffer) {
        body += value?.toString() ?? "";
      },
    } as unknown as http.ServerResponse;
    return {
      res,
      get status() {
        return status;
      },
      json: () => JSON.parse(body) as Record<string, unknown>,
    };
  }

  function request(method: string, value?: unknown): http.IncomingMessage {
    const req = { method, headers: {} } as http.IncomingMessage;
    Object.assign(req, {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "data" && value !== undefined) {
          cb(Buffer.from(JSON.stringify(value)));
        }
        if (event === "end") {
          cb();
        }
        return this;
      },
    });
    return req;
  }

  function context(workspaceDir: string): LawmindDispatchContext {
    return {
      workspaceDir,
      envFile: undefined,
      userEnvPath: path.join(workspaceDir, ".env.lawmind"),
      policy: { loaded: false },
    };
  }

  async function post(dir: string, matterId: string, body: unknown) {
    const out = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", body),
      res: out.res,
      url: new URL(`http://127.0.0.1/api/intake/admissions/${encodeURIComponent(matterId)}`),
      pathname: `/api/intake/admissions/${encodeURIComponent(matterId)}`,
      c: {},
    });
    return out;
  }

  it("returns 404 before a record exists", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    const out = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: out.res,
      url: new URL("http://127.0.0.1/api/intake/admissions/matter-a"),
      pathname: "/api/intake/admissions/matter-a",
      c: {},
    });
    expect(out.status).toBe(404);
  });

  it("drives assign → scan → acknowledge → accept and opens the gate", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", matterTitle: "甲案" });

    expect((await post(dir, "matter-a", { action: "assign", ownerLawyerId: "lawyer:zhang" })).status).toBe(200);
    expect((await post(dir, "matter-a", { action: "scan_start" })).status).toBe(200);
    expect((await post(dir, "matter-a", { action: "scan", hits: [] })).status).toBe(200);
    expect((await post(dir, "matter-a", { action: "acknowledge", risk: true, ai: true })).status).toBe(200);

    const gateBefore = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: gateBefore.res,
      url: new URL("http://127.0.0.1/api/intake/admissions/matter-a"),
      pathname: "/api/intake/admissions/matter-a",
      c: {},
    });
    expect(gateBefore.json().gate).toMatchObject({ allowed: false, reason: "lawyer_review" });

    const accepted = await post(dir, "matter-a", { action: "accept" });
    expect(accepted.status).toBe(200);
    expect(accepted.json().admission).toMatchObject({ status: "accepted" });
    expect(loadMatter(dir, "matter-a")?.status).toBe("active");

    const gateAfter = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: gateAfter.res,
      url: new URL("http://127.0.0.1/api/intake/admissions/matter-a"),
      pathname: "/api/intake/admissions/matter-a",
      c: {},
    });
    expect(gateAfter.json().gate).toMatchObject({ allowed: true });
  });

  it("creates a record for an existing intake matter", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    const created = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", { matterId: "matter-a" }),
      res: created.res,
      url: new URL("http://127.0.0.1/api/intake/admissions"),
      pathname: "/api/intake/admissions",
      c: {},
    });
    expect(created.status).toBe(200);
    expect(created.json().admission).toMatchObject({
      matterId: "matter-a",
      status: "prospective",
    });

    const missing = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", { matterId: "no-such-matter" }),
      res: missing.res,
      url: new URL("http://127.0.0.1/api/intake/admissions"),
      pathname: "/api/intake/admissions",
      c: {},
    });
    expect(missing.status).toBe(404);
  });

  it("generates the engagement package and refuses silent overwrite", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "lawyer:zhang" });
    const engagementPath = "/api/intake/admissions/matter-a/engagement";
    const postEngagement = async (body: unknown) => {
      const out = response();
      await handleMailRoutes({
        ctx: context(dir),
        req: request("POST", body),
        res: out.res,
        url: new URL(`http://127.0.0.1${engagementPath}`),
        pathname: engagementPath,
        c: {},
      });
      return out;
    };

    const first = await postEngagement({ clientName: "张三", feeText: "按标的额 5% 收取" });
    expect(first.status).toBe(200);
    expect(first.json().manifest).toMatchObject({
      draft: true,
      esign: { status: "placeholder", provider: null },
    });
    expect((first.json().manifest as { files: unknown[] }).files).toHaveLength(5);

    const read = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: read.res,
      url: new URL(`http://127.0.0.1${engagementPath}`),
      pathname: engagementPath,
      c: {},
    });
    expect(read.status).toBe(200);

    const second = await postEngagement({ clientName: "张三", feeText: "按标的额 5% 收取" });
    expect(second.status).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: "exists" });

    const overwrite = await postEngagement({
      clientName: "张三",
      feeText: "按标的额 5% 收取",
      overwrite: true,
    });
    expect(overwrite.status).toBe(200);
  });

  it("exports the engagement package to docx and refuses silent overwrite", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "lawyer:zhang" });
    const engagementPath = "/api/intake/admissions/matter-a/engagement";
    const generated = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", { clientName: "张三", feeText: "按标的额 5% 收取" }),
      res: generated.res,
      url: new URL(`http://127.0.0.1${engagementPath}`),
      pathname: engagementPath,
      c: {},
    });
    expect(generated.status).toBe(200);

    const docxPath = `${engagementPath}/docx`;
    const postDocx = async (body?: unknown) => {
      const out = response();
      await handleMailRoutes({
        ctx: context(dir),
        req: request("POST", body),
        res: out.res,
        url: new URL(`http://127.0.0.1${docxPath}`),
        pathname: docxPath,
        c: {},
      });
      return out;
    };

    const first = await postDocx();
    expect(first.status).toBe(200);
    expect((first.json().files as unknown[]).length).toBe(5);
    expect(first.json().generatedAt).toEqual(expect.any(String));

    const second = await postDocx();
    expect(second.status).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: "exists" });

    const overwrite = await postDocx({ overwrite: true });
    expect(overwrite.status).toBe(200);
    expect((overwrite.json().files as unknown[]).length).toBe(5);
  });

  it("reports a missing engagement package before docx export", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "lawyer:zhang" });
    const docxPath = "/api/intake/admissions/matter-a/engagement/docx";
    const out = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", {}),
      res: out.res,
      url: new URL(`http://127.0.0.1${docxPath}`),
      pathname: docxPath,
      c: {},
    });
    expect(out.status).toBe(404);
    expect(out.json()).toMatchObject({ ok: false, error: "package_not_found" });
  });

  it("applies extracted intake fields with provenance and reports coverage", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "lawyer:zhang" });
    const item = recordIntakeItem(dir, {
      channel: "email",
      externalKey: "email:admission:provenance",
      receivedAt: "2026-10-27T01:00:00.000Z",
      from: { display: "王五", address: "wang@client.test" },
      subject: "材料",
      text: "（2026）沪01民初1001号\n被告：李四",
      attachments: [],
    }).item;
    const provenancePath = "/api/intake/admissions/matter-a/provenance";
    const applied = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", { itemId: item.id }),
      res: applied.res,
      url: new URL(`http://127.0.0.1${provenancePath}`),
      pathname: provenancePath,
      c: {},
    });
    expect(applied.status).toBe(200);
    expect(applied.json()).toMatchObject({
      ok: true,
      applied: ["docket.caseNo", "counterparty"],
      conflicts: [],
    });
    expect(loadMatter(dir, "matter-a")?.docket?.caseNo).toBe("（2026）沪01民初1001号");
    expect(loadMatter(dir, "matter-a")?.counterparty).toBe("李四");

    const read = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: read.res,
      url: new URL(`http://127.0.0.1${provenancePath}`),
      pathname: provenancePath,
      c: {},
    });
    expect(read.status).toBe(200);
    const body = read.json() as {
      entries?: Array<{ itemId?: string; quote?: string }>;
      coverage?: { missing?: unknown[] };
    };
    expect(body.entries).toHaveLength(2);
    expect(body.entries?.[0]?.itemId).toBe(item.id);
    expect(body.entries?.[0]?.quote).toBeTruthy();
    expect(body.coverage?.missing).toEqual([]);
  });

  it("extracts summons dates and writes them into the deadline chain", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a", ownerLawyerId: "lawyer:zhang" });
    const item = recordIntakeItem(dir, {
      channel: "email",
      externalKey: "email:admission:summons",
      receivedAt: "2026-10-27T01:00:00.000Z",
      from: { display: "法院", address: "court@court.test" },
      subject: "传票",
      text: "传票：请于2026年11月20日 09:30 到第三法庭参加诉讼。案号（2026）沪01民初1001号。",
      attachments: [],
    }).item;

    const events = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("GET"),
      res: events.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/legal-events`),
      pathname: `/api/intake/items/${item.id}/legal-events`,
      c: {},
    });
    expect(events.status).toBe(200);
    const body = events.json() as {
      events?: Array<{ eventKind: string; title: string; dueAt?: string }>;
    };
    const hearing = body.events?.find((event) => event.eventKind === "hearing");
    expect(hearing?.dueAt).toBe("2026-11-20T01:30:00.000Z");

    const confirmed = response();
    await handleMailRoutes({
      ctx: context(dir),
      req: request("POST", {
        events: [
          {
            eventKind: "hearing",
            title: "开庭",
            dueAt: hearing?.dueAt,
            notes: "传票",
          },
        ],
      }),
      res: confirmed.res,
      url: new URL("http://127.0.0.1/api/intake/admissions/matter-a/legal-events"),
      pathname: "/api/intake/admissions/matter-a/legal-events",
      c: {},
    });
    expect(confirmed.status).toBe(200);
    expect(loadMatter(dir, "matter-a")?.docket?.hearingAt).toBe("2026-11-20T01:30:00.000Z");
    const deadlines = listDeadlinesForMatter(dir, "matter-a");
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      eventKind: "hearing",
      source: "document_extract",
      dueAt: "2026-11-20T01:30:00.000Z",
    });
  });

  it("runs the conflict scan service and records hit provenance", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createMatterIfMissing(dir, { matterId: "matter-b", title: "乙案", status: "closed" });
    await updateMatterProfile(dir, {
      matterId: "matter-b",
      parties: [{ partyId: "p1", name: "李四", role: "counterparty" }],
    });
    createAdmission(dir, {
      matterId: "matter-a",
      candidates: [{ name: "李四", role: "related", source: "intake" }],
    });
    const scanned = await post(dir, "matter-a", { action: "scan_run" });
    expect(scanned.status).toBe(200);
    const body = scanned.json() as {
      admission?: { status?: string; conflict?: { status?: string; hits?: unknown[] } };
      scan?: { hits?: Array<{ matterId?: string; source?: string }> };
    };
    expect(body.admission?.status).toBe("lawyer_review");
    expect(body.admission?.conflict?.status).toBe("hit");
    expect(body.scan?.hits).toEqual([
      expect.objectContaining({ matterId: "matter-b", source: "matter_record" }),
    ]);
  });

  it("adds lawyer candidates before scanning", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, { matterId: "matter-a" });
    const added = await post(dir, "matter-a", {
      action: "add_candidates",
      candidates: [{ name: "周八", role: "client", source: "lawyer" }],
    });
    expect(added.status).toBe(200);
    const scanned = await post(dir, "matter-a", { action: "scan_run" });
    expect(scanned.status).toBe(200);
  });

  it("rejects accept with a conflict hit and no written override", async () => {
    const dir = workspace();
    createMatterIfMissing(dir, { matterId: "matter-a", title: "甲案", status: "intake" });
    createAdmission(dir, {
      matterId: "matter-a",
      ownerLawyerId: "lawyer:zhang",
      candidates: [{ name: "李四", role: "related", source: "intake" }],
    });
    await post(dir, "matter-a", {
      action: "scan",
      hits: [
        {
          matterId: "other-matter",
          partyName: "李四",
          reason: "同名",
          source: "matter_record",
        },
      ],
    });
    await post(dir, "matter-a", { action: "acknowledge", risk: true, ai: true });
    const rejected = await post(dir, "matter-a", { action: "accept" });
    expect(rejected.status).toBe(400);
    expect(rejected.json()).toMatchObject({ ok: false, error: "conflict_override_required" });

    const accepted = await post(dir, "matter-a", {
      action: "accept",
      overrideReason: "双方书面同意",
    });
    expect(accepted.status).toBe(200);
  });
});
