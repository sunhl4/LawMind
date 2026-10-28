import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPacketZip,
  exportDeliveryPacket,
  packetArchiveName,
  packetBatesLabel,
  packetDownloadFileName,
} from "./packet-export.js";
import {
  packetCanSend,
  buildPacketManifest,
  createDeliveryPacket,
  type PacketSection,
} from "./packet.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packet-export-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  while (dirs.length) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function write(ws: string, rel: string, content: string | Buffer): void {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function sections(withMissing = false): PacketSection[] {
  return [
    {
      sectionId: "cover",
      kind: "cover",
      title: "封面",
      documents: [{ docId: "cover", path: "cases/m1/cover.md", required: true }],
    },
    {
      sectionId: "opinion",
      kind: "opinion",
      title: "意见",
      documents: [
        { docId: "opinion", path: "cases/m1/opinion.md", title: "意见书", required: true },
        ...(withMissing
          ? [
              {
                docId: "annex",
                path: "cases/m1/annex.pdf",
                title: "附件",
                required: false,
              },
            ]
          : []),
      ],
    },
  ];
}

function manifest(ws: string, withMissing = false) {
  const packet = createDeliveryPacket({
    matterId: "m1",
    packetId: "pkt_export",
    title: "甲公司 / 乙公司 交付包",
    audience: "client",
    sections: sections(withMissing),
    at: "2026-10-27T04:00:00.000Z",
  });
  return buildPacketManifest(ws, packet, undefined, { at: "2026-10-27T04:00:00.000Z" });
}

describe("DeliveryPacket export", () => {
  it("builds a deterministic ZIP with ordered names and a manifest", async () => {
    const ws = tmpWs();
    write(ws, "cases/m1/cover.md", "# 封面");
    write(ws, "cases/m1/opinion.md", "意见");
    const m = manifest(ws);
    expect(packetCanSend(m)).toBe(true);

    const first = await buildPacketZip(ws, m);
    const second = await buildPacketZip(ws, m);
    expect(first.equals(second)).toBe(true);

    const zip = await JSZip.loadAsync(first);
    expect(Object.keys(zip.files).toSorted()).toEqual([
      "00_manifest.json",
      "01_cover.md",
      "02_opinion.md",
    ]);
    const meta = JSON.parse(await zip.file("00_manifest.json")!.async("string")) as {
      packetHash: string;
      files: Array<{ path: string }>;
    };
    expect(meta.packetHash).toBe(m.packetHash);
    expect(meta.files.map((f) => f.path)).toEqual(["cases/m1/cover.md", "cases/m1/opinion.md"]);
    expect(await zip.file("02_opinion.md")!.async("string")).toBe("意见");
  });

  it("returns individual files without reading them into an archive", async () => {
    const ws = tmpWs();
    write(ws, "cases/m1/cover.md", "a");
    write(ws, "cases/m1/opinion.md", "b");
    const m = manifest(ws);
    const result = await exportDeliveryPacket(ws, m, "individual");
    expect(result.ok).toBe(true);
    if (result.ok && result.format === "individual") {
      expect(result.files.map((f) => f.order)).toEqual([1, 2]);
    }
  });

  it("refuses blocked packets and does not silently fall back to ZIP", async () => {
    const ws = tmpWs();
    write(ws, "cases/m1/cover.md", "a");
    write(ws, "cases/m1/opinion.md", "b");
    const m = manifest(ws, true);
    expect(m.warnings.length).toBeGreaterThan(0);
    expect(packetCanSend(m)).toBe(true);
    await expect(buildPacketZip(ws, m)).resolves.toBeInstanceOf(Buffer);

    const blocked = { ...m, blockers: ["缺少必需文件：x"] };
    const result = await exportDeliveryPacket(ws, blocked, "zip");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("blocked");
    }
    await expect(buildPacketZip(ws, blocked)).rejects.toThrow(/packet_blocked/);
  });

  it("reports mixed formats instead of silently falling back to ZIP or PDF", async () => {
    const ws = tmpWs();
    write(ws, "cases/m1/cover.md", "# 封面");
    write(ws, "cases/m1/opinion.md", "意见");
    const result = await exportDeliveryPacket(ws, manifest(ws), "merged_pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("mixed_formats");
      expect(result.message).toContain("只能包含 PDF");
    }
  });

  async function makePdf(text: string): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(text, { x: 24, y: 120, size: 14, font });
    return Buffer.from(await doc.save());
  }

  function pdfPacket(over: { bates?: { prefix?: string; start?: number; pad?: number } } = {}) {
    return createDeliveryPacket({
      matterId: "m1",
      packetId: "pkt_pdf",
      title: "甲公司交付包",
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
      ...(over.bates ? { output: { format: "merged_pdf" as const, bates: over.bates } } : {}),
    });
  }

  it("merges all-PDF packets in order and can stamp continuous Bates numbers", async () => {
    const ws = tmpWs();
    write(ws, "cases/m1/a.pdf", await makePdf("First page"));
    write(ws, "cases/m1/b.pdf", await makePdf("Second page"));
    const base = buildPacketManifest(ws, pdfPacket());
    expect(packetCanSend(base)).toBe(true);

    const merged = await exportDeliveryPacket(ws, base, "merged_pdf");
    expect(merged.ok).toBe(true);
    if (!merged.ok || merged.format !== "merged_pdf") {
      return;
    }
    expect(merged.contentType).toBe("application/pdf");
    expect(merged.fileName.endsWith(".pdf")).toBe(true);
    expect(merged.content.subarray(0, 4).toString()).toBe("%PDF");

    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: merged.content });
    try {
      const text = await parser.getText();
      expect(text.total).toBe(2);
      expect(text.text).toContain("First page");
      expect(text.text).toContain("Second page");
      expect(text.text).not.toContain("A0005");
    } finally {
      void Promise.resolve(parser.destroy()).catch(() => undefined);
    }

    const withBates = buildPacketManifest(
      ws,
      pdfPacket({ bates: { prefix: "A", start: 5, pad: 4 } }),
    );
    const stamped = await exportDeliveryPacket(ws, withBates, "merged_pdf");
    expect(stamped.ok).toBe(true);
    if (!stamped.ok || stamped.format !== "merged_pdf") {
      return;
    }
    const stampedParser = new PDFParse({ data: stamped.content });
    try {
      const text = await stampedParser.getText();
      expect(text.text).toContain("A0005");
      expect(text.text).toContain("A0006");
    } finally {
      void Promise.resolve(stampedParser.destroy()).catch(() => undefined);
    }
  });

  it("formats Bates labels with a stable prefix and padding", () => {
    expect(packetBatesLabel({ prefix: "A", start: 5, pad: 4, index: 0 })).toBe("A0005");
    expect(packetBatesLabel({ prefix: "A", start: 5, pad: 4, index: 1 })).toBe("A0006");
    expect(packetBatesLabel({ index: 0 })).toBe("LM000001");
  });

  it("keeps archive and download names filesystem-safe", () => {
    expect(
      packetArchiveName({
        order: 3,
        sectionId: "s",
        docId: "d",
        path: "cases/m1/证据/合同 final.pdf",
        sha256: "a".repeat(64),
        bytes: 1,
      }),
    ).toBe("03_合同 final.pdf");
    expect(packetDownloadFileName("甲/乙:交付包", "client", "abcdef0123456789")).toBe(
      "甲_乙_交付包_client_abcdef01.zip",
    );
  });
});
