import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { handleMailRoutes } from "./lawmind-server-route-mail.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";
import { createMatterIfMissing, updateMatterProfile } from "../../../src/lawmind/application/services/matter-write-service.js";
import { hydrateMatterParties } from "../../../src/lawmind/desk/matter-parties.js";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { recordIntakeItem, getIntakeItem, putIntakeBlob, updateIntakeItem } from "../../../src/lawmind/intake/store.js";
import { attachIntakeItem } from "../../../src/lawmind/intake/filing.js";

describe("lawmind-server-route-mail intake routes", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function response() {
    let status = 0;
    let body = "";
    let headers: Record<string, string> = {};
    const res = {
      writeHead(next: number, nextHeaders?: Record<string, string>) {
        status = next;
        if (nextHeaders) {
          headers = nextHeaders;
        }
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
      get headers() {
        return headers;
      },
      text: () => body,
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

  it("lists, ignores, restores, and attaches intake items without exposing full blobs", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "matter-a", title: "甲案" });
    const item = recordIntakeItem(workspaceDir, {
      channel: "upload",
      externalKey: "upload:route",
      receivedAt: "2026-10-26T00:00:00.000Z",
      subject: "来件",
      text: "不可信原文",
      attachments: [],
    }).item;
    const list = response();
    await expect(handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: list.res,
      url: new URL("http://127.0.0.1/api/intake/items"),
      pathname: "/api/intake/items",
      c: {},
    })).resolves.toBe(true);
    expect(list.status).toBe(200);
    expect(list.json().items[0].text).toBe("不可信原文");

    const ignored = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST"),
      res: ignored.res,
      url: new URL("http://127.0.0.1/api/intake/items/" + item.id + "/ignore"),
      pathname: `/api/intake/items/${item.id}/ignore`,
      c: {},
    });
    expect(ignored.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.status).toBe("ignored");
    const restored = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST"),
      res: restored.res,
      url: new URL("http://127.0.0.1/api/intake/items/" + item.id + "/restore"),
      pathname: `/api/intake/items/${item.id}/restore`,
      c: {},
    });
    expect(restored.status).toBe(200);

    const attached = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { itemId: item.id, matterId: "matter-a" }),
      res: attached.res,
      url: new URL("http://127.0.0.1/api/intake/items/attach"),
      pathname: "/api/intake/items/attach",
      c: {},
    });
    expect(attached.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.status).toBe("attached");
  });

  it("remembers the sender through the attach route when the lawyer ticks it", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(workspaceDir, {
      matterId: "matter-a",
      parties: [{ partyId: "p-client", name: "甲公司", role: "client" }],
    });
    const item = recordIntakeItem(workspaceDir, {
      channel: "email",
      externalKey: "email:route:remember",
      receivedAt: "2026-10-26T00:00:00.000Z",
      from: { display: "张三", address: "zhang@client.test" },
      text: "材料",
      attachments: [],
    }).item;

    const attached = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", {
        itemId: item.id,
        matterId: "matter-a",
        rememberSender: true,
      }),
      res: attached.res,
      url: new URL("http://127.0.0.1/api/intake/items/attach"),
      pathname: "/api/intake/items/attach",
      c: {},
    });

    expect(attached.status).toBe(200);
    expect(attached.json()).toMatchObject({ ok: true, rememberedSender: true });
    const contacts = hydrateMatterParties(loadMatter(workspaceDir, "matter-a") ?? {}).flatMap(
      (party) => party.contacts ?? [],
    );
    expect(contacts).toContainEqual(
      expect.objectContaining({ kind: "email", value: "zhang@client.test", verified: true }),
    );
  });

  it("advances a new-case lead and only creates an intake-status matter", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-lead-route-"));
    dirs.push(workspaceDir);
    const item = recordIntakeItem(workspaceDir, {
      channel: "email",
      externalKey: "email:route:lead",
      receivedAt: "2026-10-26T00:00:00.000Z",
      from: { display: "李四", address: "li@newclient.test" },
      subject: "想咨询买卖合同纠纷",
      text: "（2026）沪01民初1001号\n被告：王五\n想做诉讼。",
      attachments: [],
    }).item;

    const stage = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { action: "conflict_pending" }),
      res: stage.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/lead`),
      pathname: `/api/intake/items/${item.id}/lead`,
      c: {},
    });
    expect(stage.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.lead?.stage).toBe("conflict_pending");

    // 没有名称不能进入收案。
    const noTitle = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { action: "accept" }),
      res: noTitle.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/lead`),
      pathname: `/api/intake/items/${item.id}/lead`,
      c: {},
    });
    expect(noTitle.status).toBe(400);

    const accepted = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { action: "accept", matterTitle: "李四买卖合同纠纷" }),
      res: accepted.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/lead`),
      pathname: `/api/intake/items/${item.id}/lead`,
      c: {},
    });
    expect(accepted.status).toBe(200);
    expect(loadMatter(workspaceDir, "李四买卖合同纠纷")?.status).toBe("intake");
    expect(loadMatter(workspaceDir, "李四买卖合同纠纷")?.docket?.caseNo).toBe(
      "（2026）沪01民初1001号",
    );
    expect(loadMatter(workspaceDir, "李四买卖合同纠纷")?.counterparty).toBe("王五");
    expect(accepted.json().provenance).toMatchObject({
      ok: true,
      applied: ["docket.caseNo", "counterparty"],
      conflicts: [],
    });
    expect(getIntakeItem(workspaceDir, item.id)).toMatchObject({
      status: "attached",
      lead: { stage: "accepted", matterId: "李四买卖合同纠纷" },
    });
  });

  it("rejects invalid attach matter ids", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    const item = recordIntakeItem(workspaceDir, {
      channel: "upload",
      externalKey: "upload:bad-matter",
      receivedAt: "2026-10-26T00:00:00.000Z",
      text: "x",
      attachments: [],
    }).item;
    const cap = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { itemId: item.id, matterId: "../outside" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/intake/items/attach"),
      pathname: "/api/intake/items/attach",
      c: {},
    });
    expect(cap.status).toBe(400);
  });

  it("serves the intake audio with range support and labels speakers", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    const audio = Buffer.from("ID3fake-audio-bytes");
    const sha = putIntakeBlob(workspaceDir, audio);
    const item = recordIntakeItem(workspaceDir, {
      channel: "recording",
      externalKey: "recording:route-audio",
      receivedAt: "2026-10-27T00:00:00.000Z",
      subject: "通话.mp3",
      text: "",
      attachments: [{ name: "通话.mp3", sha256: sha, size: audio.length }],
    }).item;

    const full = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: full.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/audio`),
      pathname: `/api/intake/items/${item.id}/audio`,
      c: {},
    });
    expect(full.status).toBe(200);
    expect(full.text()).toBe(audio.toString());

    const ranged = response();
    const rangeReq = request("GET");
    rangeReq.headers = { range: "bytes=0-3" } as http.IncomingHttpHeaders;
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: rangeReq,
      res: ranged.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/audio`),
      pathname: `/api/intake/items/${item.id}/audio`,
      c: {},
    });
    expect(ranged.status).toBe(206);
    expect(ranged.text()).toBe(audio.subarray(0, 4).toString());

    updateIntakeItem(workspaceDir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [{ startMs: 0, endMs: 1000, speaker: "S1", text: "你好" }],
      },
    }));
    const labeled = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { speaker: "S1", label: "张三" }),
      res: labeled.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/speakers`),
      pathname: `/api/intake/items/${item.id}/speakers`,
      c: {},
    });
    expect(labeled.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.transcript?.speakerLabels).toEqual({
      S1: "张三",
    });

    const unknown = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { speaker: "S9", label: "李四" }),
      res: unknown.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/speakers`),
      pathname: `/api/intake/items/${item.id}/speakers`,
      c: {},
    });
    expect(unknown.status).toBe(400);

    const edited = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { index: 0, text: "您好" }),
      res: edited.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/transcript-segments`),
      pathname: `/api/intake/items/${item.id}/transcript-segments`,
      c: {},
    });
    expect(edited.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.text).toBe("您好");
    expect(getIntakeItem(workspaceDir, item.id)?.transcript?.editedAt).toBeTruthy();

    const badIndex = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { index: 9, text: "越界" }),
      res: badIndex.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/transcript-segments`),
      pathname: `/api/intake/items/${item.id}/transcript-segments`,
      c: {},
    });
    expect(badIndex.status).toBe(400);
  });

  it("serves a registered attachment and never inlines executable files", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    const pdf = Buffer.from("%PDF-1.4 fake");
    const svg = Buffer.from("<svg onload=\"alert(1)\"></svg>");
    const pdfSha = putIntakeBlob(workspaceDir, pdf);
    const svgSha = putIntakeBlob(workspaceDir, svg);
    const item = recordIntakeItem(workspaceDir, {
      channel: "email",
      externalKey: "email:route-attachment",
      receivedAt: "2026-10-28T00:00:00.000Z",
      from: { display: "王五", address: "wang@example.test" },
      subject: "证据附件",
      text: "见附件。",
      attachments: [
        { name: "证据.pdf", sha256: pdfSha, size: pdf.length },
        { name: "图示.svg", sha256: svgSha, size: svg.length },
      ],
    }).item;

    const inline = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: inline.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/attachments/0`),
      pathname: `/api/intake/items/${item.id}/attachments/0`,
      c: {},
    });
    expect(inline.status).toBe(200);
    expect(inline.text()).toBe(pdf.toString());
    expect(inline.headers["content-type"]).toBe("application/pdf");
    expect(inline.headers["content-disposition"]).toContain("inline");

    const executable = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: executable.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/attachments/1`),
      pathname: `/api/intake/items/${item.id}/attachments/1`,
      c: {},
    });
    expect(executable.status).toBe(200);
    expect(executable.headers["content-type"]).toBe("application/octet-stream");
    expect(executable.headers["content-disposition"]).toContain("attachment");
    expect(executable.headers["x-content-type-options"]).toBe("nosniff");

    const missing = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: missing.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/attachments/9`),
      pathname: `/api/intake/items/${item.id}/attachments/9`,
      c: {},
    });
    expect(missing.status).toBe(404);
  });

  it("lists matter parties and maps a speaker to a party", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "matter-a", title: "甲案" });
    await updateMatterProfile(workspaceDir, {
      matterId: "matter-a",
      parties: [
        { partyId: "p-client", name: "甲公司", role: "client" },
        { partyId: "p-counterparty", name: "乙公司", role: "counterparty" },
      ],
    });
    const item = recordIntakeItem(workspaceDir, {
      channel: "upload",
      externalKey: "upload:speaker-party",
      receivedAt: "2026-10-27T00:00:00.000Z",
      text: "甲：你好。",
      attachments: [],
    }).item;
    updateIntakeItem(workspaceDir, item.id, (current) => ({
      ...current,
      transcript: {
        segments: [{ startMs: 0, endMs: 1000, speaker: "S1", text: "甲：你好。" }],
      },
    }));

    const parties = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: parties.res,
      url: new URL("http://127.0.0.1/api/intake/matter-parties?matterId=matter-a"),
      pathname: "/api/intake/matter-parties",
      c: {},
    });
    expect(parties.status).toBe(200);
    expect(parties.json().parties).toEqual([
      { partyId: "p-client", name: "甲公司", role: "client" },
      { partyId: "p-counterparty", name: "乙公司", role: "counterparty" },
    ]);

    const mapped = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { speaker: "S1", matterId: "matter-a", partyId: "p-client" }),
      res: mapped.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/speaker-parties`),
      pathname: `/api/intake/items/${item.id}/speaker-parties`,
      c: {},
    });
    expect(mapped.status).toBe(200);
    expect(getIntakeItem(workspaceDir, item.id)?.transcript?.speakerParties).toEqual({
      S1: { matterId: "matter-a", partyId: "p-client" },
    });

    const unknown = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("POST", { speaker: "S1", matterId: "matter-a", partyId: "p-ghost" }),
      res: unknown.res,
      url: new URL(`http://127.0.0.1/api/intake/items/${item.id}/speaker-parties`),
      pathname: `/api/intake/items/${item.id}/speaker-parties`,
      c: {},
    });
    expect(unknown.status).toBe(400);

    const missing = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: missing.res,
      url: new URL("http://127.0.0.1/api/intake/matter-parties?matterId=../outside"),
      pathname: "/api/intake/matter-parties",
      c: {},
    });
    expect(missing.status).toBe(404);
  });

  it("reports lawyer-filing matching quality on demand", async () => {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-intake-route-"));
    dirs.push(workspaceDir);
    createMatterIfMissing(workspaceDir, { matterId: "m-eval", title: "评测案" });
    const item = recordIntakeItem(workspaceDir, {
      channel: "upload",
      externalKey: "upload:eval",
      receivedAt: "2026-10-27T00:00:00.000Z",
      subject: "【m-eval】材料",
      text: "正文",
      attachments: [],
    }).item;
    attachIntakeItem(workspaceDir, item.id, "m-eval", { by: "lawyer" });

    const out = response();
    await handleMailRoutes({
      ctx: context(workspaceDir),
      req: request("GET"),
      res: out.res,
      url: new URL("http://127.0.0.1/api/intake/matching-eval"),
      pathname: "/api/intake/matching-eval",
      c: {},
    });
    expect(out.status).toBe(200);
    const report = out.json().report as {
      source: { labeled: number };
      falseAttach: number;
      recallAt1: number | null;
    };
    expect(report.source.labeled).toBe(1);
    expect(report.falseAttach).toBe(0);
    expect(report.recallAt1).toBe(1);
  });
});
