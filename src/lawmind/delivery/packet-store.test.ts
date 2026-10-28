import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteDeliveryPacket,
  listDeliveryPackets,
  loadDeliveryPacket,
  saveDeliveryPacket,
} from "./packet-store.js";
import { createDeliveryPacket } from "./packet.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packet-store-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  while (dirs.length) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function sample() {
  return createDeliveryPacket({
    matterId: "m1",
    packetId: "pkt_store",
    title: "甲公司交付包",
    audience: "client",
    sections: [
      {
        sectionId: "opinion",
        kind: "opinion",
        title: "法律意见",
        documents: [{ docId: "d1", path: "cases/m1/opinion.md", required: true }],
      },
    ],
    at: "2026-10-27T04:00:00.000Z",
  });
}

describe("DeliveryPacket store", () => {
  it("saves, loads and lists packets under the matter", () => {
    const ws = tmpWs();
    saveDeliveryPacket(ws, sample());
    expect(loadDeliveryPacket(ws, "m1", "pkt_store")?.title).toBe("甲公司交付包");
    expect(listDeliveryPackets(ws, "m1").map((p) => p.packetId)).toEqual(["pkt_store"]);

    const second = {
      ...sample(),
      packetId: "pkt_second",
      title: "法院包",
      audience: "court" as const,
    };
    saveDeliveryPacket(ws, second);
    expect(listDeliveryPackets(ws, "m1").map((p) => p.packetId)).toEqual([
      "pkt_second",
      "pkt_store",
    ]);
  });

  it("deletes and tolerates missing packets", () => {
    const ws = tmpWs();
    saveDeliveryPacket(ws, sample());
    expect(deleteDeliveryPacket(ws, "m1", "pkt_store")).toBe(true);
    expect(loadDeliveryPacket(ws, "m1", "pkt_store")).toBeUndefined();
    expect(deleteDeliveryPacket(ws, "m1", "pkt_store")).toBe(false);
  });

  it("rejects unsafe ids and invalid packets", () => {
    const ws = tmpWs();
    expect(() => loadDeliveryPacket(ws, "m1", "../escape")).toThrow(/unsafe packet id/);
    expect(() =>
      saveDeliveryPacket(ws, {
        ...sample(),
        sections: [],
      }),
    ).toThrow();
  });
});
