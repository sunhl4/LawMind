import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveDeliverable, saveMatterDocument } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { seedDeliveryPacketFromDeliverables } from "./packet-seed.js";
import { buildPacketManifest } from "./packet.js";

const dirs: string[] = [];

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-packet-seed-"));
  dirs.push(ws);
  return ws;
}

afterEach(() => {
  while (dirs.length) {
    fs.rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function file(ws: string, rel: string, content: string): void {
  const abs = path.join(ws, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function deliverable(
  ws: string,
  input: {
    deliverableId: string;
    kind:
      | "legal-memo"
      | "contract-review"
      | "litigation-outline"
      | "demand-letter"
      | "client-brief"
      | "evidence-timeline"
      | "general-document";
    audience: "internal" | "client" | "court" | "counterparty" | "unknown";
    status:
      | "planned"
      | "drafting"
      | "pending_review"
      | "approved"
      | "rendered"
      | "delivered"
      | "learned"
      | "blocked";
    documentId?: string;
    label?: string;
  },
): void {
  if (input.documentId) {
    saveMatterDocument(ws, {
      documentId: input.documentId,
      matterId: "m1",
      relativePath: `matters/m1/deliverables/${input.documentId}.md`,
      version: 1,
      label: input.label,
      updatedAt: "2026-10-27T04:00:00.000Z",
    });
    file(ws, `matters/m1/deliverables/${input.documentId}.md`, `# ${input.label ?? input.kind}`);
  }
  saveDeliverable(ws, {
    deliverableId: input.deliverableId,
    matterId: "m1",
    kind: input.kind,
    audience: input.audience,
    status: input.status,
    ...(input.documentId ? { documentId: input.documentId } : {}),
    createdAt: "2026-10-27T04:00:00.000Z",
    updatedAt: "2026-10-27T04:00:00.000Z",
  });
}

describe("seedDeliveryPacketFromDeliverables", () => {
  it("groups deliverables into ordered sections and respects their audience", () => {
    const ws = tmpWs();
    createMatterIfMissing(ws, { matterId: "m1", title: "甲公司诉乙公司" });
    deliverable(ws, {
      deliverableId: "d-opinion",
      kind: "legal-memo",
      audience: "client",
      status: "approved",
      documentId: "doc-opinion",
      label: "法律意见书",
    });
    deliverable(ws, {
      deliverableId: "d-evidence",
      kind: "evidence-timeline",
      audience: "court",
      status: "drafting",
      documentId: "doc-evidence",
      label: "证据目录",
    });
    deliverable(ws, {
      deliverableId: "d-internal",
      kind: "general-document",
      audience: "internal",
      status: "approved",
      documentId: "doc-internal",
      label: "内部备忘",
    });
    deliverable(ws, {
      deliverableId: "d-no-doc",
      kind: "client-brief",
      audience: "client",
      status: "planned",
    });

    const seeded = seedDeliveryPacketFromDeliverables(ws, "m1", { audience: "client" });
    expect(seeded.packet.title).toContain("客户包");
    expect(seeded.packet.sections.map((s) => s.sectionId)).toEqual([
      "deliverables:legal-memo",
      "deliverables:evidence-timeline",
      "deliverables:general-document",
    ]);
    expect(seeded.skipped).toEqual([{ deliverableId: "d-no-doc", reason: "no_document" }]);

    const manifest = buildPacketManifest(ws, seeded.packet);
    expect(manifest.files.map((f) => f.docId)).toEqual(["d-opinion"]);
    expect(manifest.sections[0]?.documents[0]?.required).toBe(true);
    // court-only 与 internal-only 文档在客户包里不算 blocker
    expect(manifest.blockers).toEqual([]);

    const court = buildPacketManifest(ws, { ...seeded.packet, audience: "court" });
    expect(court.files.map((f) => f.docId)).toEqual(["d-evidence"]);
  });

  it("skips deliverables whose document record is missing, and deduplicates paths", () => {
    const ws = tmpWs();
    createMatterIfMissing(ws, { matterId: "m1", title: "甲公司" });
    deliverable(ws, {
      deliverableId: "d-1",
      kind: "legal-memo",
      audience: "client",
      status: "drafting",
      documentId: "doc-a",
      label: "意见 A",
    });
    deliverable(ws, {
      deliverableId: "d-2",
      kind: "legal-memo",
      audience: "client",
      status: "drafting",
      documentId: "doc-b",
      label: "意见 B",
    });
    saveDeliverable(ws, {
      deliverableId: "d-missing-doc",
      matterId: "m1",
      kind: "client-brief",
      audience: "client",
      status: "planned",
      documentId: "doc-not-there",
      createdAt: "2026-10-27T04:00:00.000Z",
      updatedAt: "2026-10-27T04:00:00.000Z",
    });
    // 让 doc-b 与 doc-a 指向同一路径
    saveMatterDocument(ws, {
      documentId: "doc-b",
      matterId: "m1",
      relativePath: "matters/m1/deliverables/doc-a.md",
      version: 1,
      updatedAt: "2026-10-27T04:00:00.000Z",
    });

    const seeded = seedDeliveryPacketFromDeliverables(ws, "m1");
    expect(seeded.skipped.map((s) => s.reason).toSorted()).toEqual([
      "document_missing",
      "duplicate_path",
    ]);
    expect(seeded.packet.sections[0]?.documents).toHaveLength(1);
  });

  it("throws when the matter does not exist", () => {
    const ws = tmpWs();
    expect(() => seedDeliveryPacketFromDeliverables(ws, "missing")).toThrow(/matter_not_found/);
  });
});
