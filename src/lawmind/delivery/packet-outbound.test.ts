import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packetApprovalProblems, resolveOutboundPacket } from "./packet-outbound.js";
import { saveDeliveryPacket } from "./packet-store.js";
import { buildPacketManifest, createDeliveryPacket } from "./packet.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packet-outbound-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  while (dirs.length) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function write(ws: string, rel: string, content: string): void {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function seed(ws: string) {
  write(ws, "matters/m1/deliverables/a.md", "意见 A");
  write(ws, "matters/m1/deliverables/b.md", "附件 B");
  const packet = createDeliveryPacket({
    matterId: "m1",
    packetId: "pkt_send",
    title: "客户交付包",
    audience: "client",
    sections: [
      {
        sectionId: "s1",
        kind: "opinion",
        title: "意见",
        documents: [
          { docId: "a", path: "matters/m1/deliverables/a.md", title: "意见 A", required: true },
          { docId: "b", path: "matters/m1/deliverables/b.md", title: "附件 B" },
        ],
      },
    ],
    at: "2026-10-27T04:00:00.000Z",
  });
  saveDeliveryPacket(ws, packet);
  return packet;
}

describe("resolveOutboundPacket", () => {
  it("returns the packet's ordered attachments and binding", () => {
    const ws = tmpWs();
    const packet = seed(ws);
    const resolved = resolveOutboundPacket(ws, "m1", packet.packetId);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.attachmentRelativePaths).toEqual([
      "matters/m1/deliverables/a.md",
      "matters/m1/deliverables/b.md",
    ]);
    const manifest = buildPacketManifest(ws, packet, { audience: "client" });
    expect(resolved.packetHash).toBe(manifest.packetHash);
    expect(resolved.binding).toEqual({ packetId: "pkt_send", packetHash: manifest.packetHash });
  });

  it("allows explicit attachments that are inside the packet and rejects extras", () => {
    const ws = tmpWs();
    seed(ws);
    write(ws, "artifacts/extra.docx", "包外文件");
    expect(resolveOutboundPacket(ws, "m1", "pkt_send", ["matters/m1/deliverables/a.md"]).ok).toBe(
      true,
    );

    const outside = resolveOutboundPacket(ws, "m1", "pkt_send", ["artifacts/extra.docx"]);
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.error).toContain("不在交付包");
    }
  });

  it("refuses a blocked packet or a missing one", () => {
    const ws = tmpWs();
    const packet = seed(ws);
    fs.rmSync(path.join(ws, "matters/m1/deliverables/a.md"));
    const blocked = resolveOutboundPacket(ws, "m1", packet.packetId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockers?.[0]).toContain("缺少必需文件");
    }
    expect(resolveOutboundPacket(ws, "m1", "pkt_missing").ok).toBe(false);
  });
});

describe("packetApprovalProblems", () => {
  it("passes when the packet still matches the approved hash", () => {
    const ws = tmpWs();
    const packet = seed(ws);
    const resolved = resolveOutboundPacket(ws, "m1", packet.packetId);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(packetApprovalProblems(ws, "m1", resolved.binding)).toEqual([]);
  });

  it("reports a changed file, a blocked packet and a missing packet", () => {
    const ws = tmpWs();
    const packet = seed(ws);
    const resolved = resolveOutboundPacket(ws, "m1", packet.packetId);
    if (!resolved.ok) {
      throw new Error(resolved.error);
    }
    write(ws, "matters/m1/deliverables/b.md", "附件 B（改过）");
    expect(packetApprovalProblems(ws, "m1", resolved.binding).join("\n")).toContain("在签批后变了");

    fs.rmSync(path.join(ws, "matters/m1/deliverables/a.md"));
    expect(packetApprovalProblems(ws, "m1", resolved.binding).join("\n")).toContain(
      "交付包当前不可交付",
    );

    fs.rmSync(path.join(ws, "matters/m1/packets/pkt_send.json"));
    expect(packetApprovalProblems(ws, "m1", resolved.binding).join("\n")).toContain("已不存在");
  });
});
