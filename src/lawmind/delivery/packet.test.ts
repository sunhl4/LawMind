import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPacketManifest,
  createDeliveryPacket,
  describePacketReadiness,
  findPacketManifestEntry,
  packetCanSend,
  type DeliveryPacket,
  type PacketSection,
} from "./packet.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packet-"));
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

function sections(): PacketSection[] {
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
      title: "法律意见",
      documents: [
        { docId: "opinion", path: "cases/m1/opinion.md", title: "意见书", required: true },
      ],
    },
    {
      sectionId: "evidence",
      kind: "evidence_index",
      title: "证据目录",
      documents: [
        {
          docId: "evidence",
          path: "cases/m1/evidence.csv",
          title: "证据目录",
          required: false,
        },
      ],
    },
  ];
}

function packet(over: Partial<DeliveryPacket> = {}): DeliveryPacket {
  return {
    ...createDeliveryPacket({
      matterId: "m1",
      packetId: "pkt_fixed",
      title: "甲公司诉乙公司案交付包",
      audience: "client",
      sections: sections(),
      at: "2026-10-27T04:00:00.000Z",
    }),
    ...over,
  };
}

function seed(ws: string): void {
  write(ws, "cases/m1/cover.md", "# 封面");
  write(ws, "cases/m1/opinion.md", "法律意见正文");
  write(ws, "cases/m1/evidence.csv", "序号,名称\n1,合同\n");
}

describe("DeliveryPacket manifest", () => {
  it("orders files across sections and exposes a stable hash", () => {
    const ws = tmpWs();
    seed(ws);
    const first = buildPacketManifest(ws, packet(), undefined, {
      at: "2026-10-27T04:00:00.000Z",
    });
    const second = buildPacketManifest(ws, packet(), undefined, {
      at: "2026-10-28T04:00:00.000Z",
    });
    expect(first.blockers).toEqual([]);
    expect(first.warnings).toEqual([]);
    expect(first.files.map((f) => [f.order, f.docId])).toEqual([
      [1, "cover"],
      [2, "opinion"],
      [3, "evidence"],
    ]);
    expect(first.files[1]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(packetCanSend(first)).toBe(true);
    // generatedAt 不进哈希
    expect(second.packetHash).toBe(first.packetHash);
  });

  it("changes the hash when a file is added, reordered, retitled or sent to another audience", () => {
    const ws = tmpWs();
    seed(ws);
    write(ws, "cases/m1/annex.md", "附件");
    const base = buildPacketManifest(ws, packet());
    const baseHash = base.packetHash;

    const withAnnex = buildPacketManifest(
      ws,
      packet({
        sections: [
          ...sections(),
          {
            sectionId: "annex",
            kind: "attachment",
            title: "附件",
            documents: [{ docId: "annex", path: "cases/m1/annex.md" }],
          },
        ],
      }),
    );
    expect(withAnnex.packetHash).not.toBe(baseHash);

    const reordered: PacketSection[] = [sections()[1], sections()[0], sections()[2]];
    const reorderedManifest = buildPacketManifest(ws, packet({ sections: reordered }));
    expect(reorderedManifest.packetHash).not.toBe(baseHash);
    expect(reorderedManifest.files[0]?.docId).toBe("opinion");

    const retitled = buildPacketManifest(ws, packet({ title: "另一个封面标题" }));
    expect(retitled.packetHash).not.toBe(baseHash);

    const court = buildPacketManifest(ws, packet({ audience: "court" }));
    expect(court.packetHash).not.toBe(baseHash);
    expect(court.audience).toBe("court");
  });

  it("blocks on missing required documents and only warns on missing optional ones", () => {
    const ws = tmpWs();
    write(ws, "cases/m1/cover.md", "# 封面");
    const manifest = buildPacketManifest(ws, packet());
    expect(packetCanSend(manifest)).toBe(false);
    expect(manifest.blockers.join("\n")).toContain("缺少必需文件：cases/m1/opinion.md");
    expect(manifest.warnings.join("\n")).toContain("可选文件缺失：cases/m1/evidence.csv");
    expect(manifest.files.map((f) => f.docId)).toEqual(["cover"]);
    expect(describePacketReadiness(manifest)).toContain("不可交付");
  });

  it("rejects files from another matter and unsafe paths", () => {
    const ws = tmpWs();
    seed(ws);
    write(ws, "cases/m2/secret.md", "他案材料");
    const manifest = buildPacketManifest(
      ws,
      packet({
        sections: [
          {
            sectionId: "bad",
            kind: "attachment",
            title: "混入",
            documents: [
              { docId: "other", path: "cases/m2/secret.md" },
              { docId: "escape", path: "../outside.md" },
            ],
          },
        ],
      }),
    );
    expect(packetCanSend(manifest)).toBe(false);
    expect(manifest.blockers.join("\n")).toContain("其它案件");
    expect(manifest.blockers.join("\n")).toContain("不得包含 ..");
    expect(manifest.files).toEqual([]);
    expect(findPacketManifestEntry(manifest, "other")?.excludedReason).toBe("cross_matter");
    expect(findPacketManifestEntry(manifest, "escape")?.excludedReason).toBe("unsafe_path");
  });

  it("filters by audience and evaluates conditions at manifest time", () => {
    const ws = tmpWs();
    seed(ws);
    write(ws, "cases/m1/court-only.md", "法院专用");
    const manifest = buildPacketManifest(
      ws,
      packet({
        sections: [
          {
            sectionId: "conditional",
            kind: "attachment",
            title: "按受众与阶段",
            documents: [
              {
                docId: "court-only",
                path: "cases/m1/court-only.md",
                audiences: ["court"],
              },
              {
                docId: "filed-only",
                path: "cases/m1/cover.md",
                required: true,
                enabledWhen: { kind: "stage_in", stages: ["filed"] },
              },
              {
                docId: "client-role",
                path: "cases/m1/evidence.csv",
                enabledWhen: { kind: "party_role_present", role: "client" },
              },
            ],
          },
        ],
      }),
      { audience: "client", stage: "intake", partyRoles: ["Client"] },
    );
    expect(findPacketManifestEntry(manifest, "court-only")?.excludedReason).toBe("audience");
    expect(findPacketManifestEntry(manifest, "filed-only")?.excludedReason).toBe("condition");
    expect(findPacketManifestEntry(manifest, "client-role")?.included).toBe(true);
    // 被条件排除的 required 不是 blocker
    expect(manifest.blockers).toEqual([]);
  });

  it("warns and keeps only the first occurrence of a duplicated path", () => {
    const ws = tmpWs();
    seed(ws);
    const manifest = buildPacketManifest(
      ws,
      packet({
        sections: [
          {
            sectionId: "dup",
            kind: "attachment",
            title: "重复",
            documents: [
              { docId: "a", path: "cases/m1/opinion.md" },
              { docId: "b", path: "cases/m1/opinion.md" },
            ],
          },
        ],
      }),
    );
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.docId).toBe("a");
    expect(findPacketManifestEntry(manifest, "b")?.excludedReason).toBe("duplicate");
    expect(manifest.warnings.join("\n")).toContain("重复");
  });

  it("keeps output format out of the approved-content hash", () => {
    const ws = tmpWs();
    seed(ws);
    const individual = buildPacketManifest(ws, packet({ output: { format: "individual" } }));
    const merged = buildPacketManifest(
      ws,
      packet({ output: { format: "merged_pdf", bates: { prefix: "A", start: 1 } } }),
    );
    expect(individual.output?.format).toBe("individual");
    expect(merged.output?.format).toBe("merged_pdf");
    expect(merged.packetHash).toBe(individual.packetHash);
  });

  it("blocks an empty packet", () => {
    const ws = tmpWs();
    const manifest = buildPacketManifest(
      ws,
      packet({
        sections: [
          {
            sectionId: "only",
            kind: "attachment",
            title: "空",
            documents: [{ docId: "missing", path: "cases/m1/missing.md" }],
          },
        ],
      }),
    );
    expect(packetCanSend(manifest)).toBe(false);
    expect(manifest.blockers.join("\n")).toContain("没有任何可交付文件");
  });
});
