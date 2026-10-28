import fs from "node:fs";
import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import {
  saveDeliverable,
  saveMatterDocument,
} from "../../../src/lawmind/adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../../../src/lawmind/application/services/matter-write-service.js";
import { createDeliveryPacket } from "../../../src/lawmind/delivery/packet.js";
import { loadDeliveryPacket, saveDeliveryPacket } from "../../../src/lawmind/delivery/packet-store.js";
import { handleDeliveryPacketRoutes } from "./lawmind-server-route-delivery-packets.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

function captureRes() {
  let status = 0;
  let body = Buffer.alloc(0);
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
      if (c) {
        body = Buffer.concat([body, Buffer.isBuffer(c) ? c : Buffer.from(c)]);
      }
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
      return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    },
    headers,
  };
}

function ctxFor(workspaceDir: string): LawmindDispatchContext {
  return {
    workspaceDir,
    envFile: undefined,
    userEnvPath: path.join(workspaceDir, ".env.lawmind"),
    policy: { loaded: false },
  };
}

function postReq(body: unknown): http.IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, { method: "POST" }) as unknown as http.IncomingMessage;
}

const tmp: string[] = [];

afterEach(() => {
  for (const dir of tmp.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packets-route-"));
  tmp.push(ws);
  return ws;
}

function seedMatter(ws: string): void {
  createMatterIfMissing(ws, { matterId: "m1", title: "甲公司诉乙公司" });
  fs.mkdirSync(path.join(ws, "matters", "m1", "deliverables"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "matters", "m1", "deliverables", "doc-a.md"),
    "法律意见正文",
    "utf8",
  );
  saveMatterDocument(ws, {
    documentId: "doc-a",
    matterId: "m1",
    relativePath: "matters/m1/deliverables/doc-a.md",
    version: 1,
    label: "法律意见书",
    updatedAt: "2026-10-27T04:00:00.000Z",
  });
  saveDeliverable(ws, {
    deliverableId: "d-a",
    matterId: "m1",
    kind: "legal-memo",
    audience: "client",
    status: "approved",
    documentId: "doc-a",
    createdAt: "2026-10-27T04:00:00.000Z",
    updatedAt: "2026-10-27T04:00:00.000Z",
  });
}

describe("handleDeliveryPacketRoutes", () => {
  it("lists nothing before a packet exists", async () => {
    const ws = makeWs();
    const cap = captureRes();
    const handled = await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    expect(cap.json().packets).toEqual([]);
  });

  it("seeds a packet from deliverables, persists it, and returns a manifest", async () => {
    const ws = makeWs();
    seedMatter(ws);
    const cap = captureRes();
    const handled = await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({ action: "seed", audience: "client" }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    const json = cap.json();
    const packet = json.packet as { packetId: string; matterId: string };
    expect(packet.matterId).toBe("m1");
    expect(loadDeliveryPacket(ws, "m1", packet.packetId)?.title).toContain("客户包");
    expect(json.blockers).toEqual([]);
    expect((json.packetHash as string).length).toBe(32);
  });

  it("saves an edited packet and reports a changed hash", async () => {
    const ws = makeWs();
    seedMatter(ws);
    const base = createDeliveryPacket({
      matterId: "m1",
      packetId: "pkt_edit",
      title: "甲公司交付包",
      audience: "client",
      sections: [
        {
          sectionId: "s1",
          kind: "opinion",
          title: "意见",
          documents: [{ docId: "d-a", path: "matters/m1/deliverables/doc-a.md" }],
        },
      ],
      at: "2026-10-27T04:00:00.000Z",
    });
    const first = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({ action: "save", packet: base }),
      res: first.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(first.status).toBe(200);
    const firstHash = first.json().packetHash as string;

    const second = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({
        action: "save",
        packet: { ...base, audience: "court", updatedAt: "2026-10-27T05:00:00.000Z" },
      }),
      res: second.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(second.status).toBe(200);
    expect(second.json().packetHash).not.toBe(firstHash);
    expect(loadDeliveryPacket(ws, "m1", "pkt_edit")?.audience).toBe("court");
  });

  it("rejects a packet that belongs to another matter", async () => {
    const ws = makeWs();
    seedMatter(ws);
    const packet = createDeliveryPacket({
      matterId: "m2",
      packetId: "pkt_other",
      title: "他案包",
      audience: "client",
      sections: [
        {
          sectionId: "s1",
          kind: "attachment",
          title: "附件",
          documents: [{ docId: "d", path: "cases/m2/x.md" }],
        },
      ],
    });
    const cap = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({ action: "save", packet }),
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(cap.status).toBe(400);
    expect(cap.json().code).toBe("matter_mismatch");
  });

  it("exports ZIP, individual files, blocks blocked packets, and reports merged PDF as unsupported", async () => {
    const ws = makeWs();
    seedMatter(ws);
    const packet = createDeliveryPacket({
      matterId: "m1",
      packetId: "pkt_export",
      title: "甲公司交付包",
      audience: "client",
      sections: [
        {
          sectionId: "s1",
          kind: "opinion",
          title: "意见",
          documents: [
            { docId: "d-a", path: "matters/m1/deliverables/doc-a.md", required: true },
            { docId: "missing", path: "matters/m1/deliverables/missing.md" },
          ],
        },
      ],
    });
    const saved = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({ action: "save", packet }),
      res: saved.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(saved.status).toBe(200);

    const zip = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_export/export",
      req: { method: "GET" } as http.IncomingMessage,
      res: zip.res,
      url: new URL(
        "http://127.0.0.1/api/matters/m1/delivery-packets/pkt_export/export?format=zip",
      ),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(zip.status).toBe(200);
    expect(zip.headers["content-type"]).toBe("application/zip");
    expect(zip.body.subarray(0, 2).toString()).toBe("PK");

    const individual = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_export/export",
      req: { method: "GET" } as http.IncomingMessage,
      res: individual.res,
      url: new URL(
        "http://127.0.0.1/api/matters/m1/delivery-packets/pkt_export/export?format=individual",
      ),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(individual.status).toBe(200);
    expect((individual.json().files as unknown[]).length).toBe(1);

    const merged = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_export/export",
      req: { method: "GET" } as http.IncomingMessage,
      res: merged.res,
      url: new URL(
        "http://127.0.0.1/api/matters/m1/delivery-packets/pkt_export/export?format=merged_pdf",
      ),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(merged.status).toBe(400);
    expect(merged.json().error).toBe("mixed_formats");

    // 把必需文件删掉 → 导出被拒
    fs.rmSync(path.join(ws, "matters", "m1", "deliverables", "doc-a.md"));
    const blocked = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_export/export",
      req: { method: "GET" } as http.IncomingMessage,
      res: blocked.res,
      url: new URL(
        "http://127.0.0.1/api/matters/m1/delivery-packets/pkt_export/export?format=zip",
      ),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.json().error).toBe("packet_blocked");
  });

  it("exports a merged PDF when the packet only contains PDFs", async () => {
    const ws = makeWs();
    createMatterIfMissing(ws, { matterId: "m1", title: "甲公司" });
    fs.mkdirSync(path.join(ws, "cases", "m1"), { recursive: true });
    for (const [name, text] of [
      ["a.pdf", "First page"],
      ["b.pdf", "Second page"],
    ] as const) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([300, 200]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText(text, { x: 24, y: 120, size: 14, font });
      fs.writeFileSync(path.join(ws, "cases", "m1", name), Buffer.from(await doc.save()));
    }
    saveDeliveryPacket(
      ws,
      createDeliveryPacket({
        matterId: "m1",
        packetId: "pkt_pdf",
        title: "PDF 交付包",
        audience: "client",
        sections: [
          {
            sectionId: "s1",
            kind: "attachment",
            title: "材料",
            documents: [
              { docId: "a", path: "cases/m1/a.pdf", required: true },
              { docId: "b", path: "cases/m1/b.pdf", required: true },
            ],
          },
        ],
      }),
    );

    const cap = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_pdf/export",
      req: { method: "GET" } as http.IncomingMessage,
      res: cap.res,
      url: new URL(
        "http://127.0.0.1/api/matters/m1/delivery-packets/pkt_pdf/export?format=merged_pdf",
      ),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(cap.status).toBe(200);
    expect(cap.headers["content-type"]).toBe("application/pdf");
    expect(cap.body.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("deletes a packet", async () => {
    const ws = makeWs();
    seedMatter(ws);
    const packet = createDeliveryPacket({
      matterId: "m1",
      packetId: "pkt_del",
      title: "待删包",
      audience: "client",
      sections: [
        {
          sectionId: "s1",
          kind: "attachment",
          title: "附件",
          documents: [{ docId: "d", path: "matters/m1/deliverables/doc-a.md" }],
        },
      ],
    });
    const saved = captureRes();
    await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets",
      req: postReq({ action: "save", packet }),
      res: saved.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets"),
      c: {},
      ctx: ctxFor(ws),
    });
    const cap = captureRes();
    const handled = await handleDeliveryPacketRoutes({
      pathname: "/api/matters/m1/delivery-packets/pkt_del",
      req: { method: "DELETE" } as http.IncomingMessage,
      res: cap.res,
      url: new URL("http://127.0.0.1/api/matters/m1/delivery-packets/pkt_del"),
      c: {},
      ctx: ctxFor(ws),
    });
    expect(handled).toBe(true);
    expect(cap.status).toBe(200);
    expect(loadDeliveryPacket(ws, "m1", "pkt_del")).toBeUndefined();
  });
});
