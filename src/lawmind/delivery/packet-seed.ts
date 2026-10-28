/**
 * 从案件现有成果物生成一份交付包草稿。
 *
 * 只做「有依据的初始值」：文件路径来自 `MatterDocumentRecord.relativePath`，
 * 受众来自成果物自己的 `audience`，approved/rendered/delivered 的成果物默认 required。
 * 律师仍要在桌面清单里勾选、改受众、补封面后再批准。
 */

import {
  listDeliverablesForMatter,
  loadMatter,
  loadMatterDocument,
} from "../adapters/matter-storage/index.js";
import type { DeliverableRecord } from "../adapters/matter-storage/schema.js";
import {
  createDeliveryPacket,
  type DeliveryPacket,
  type DeliveryPacketDocument,
  type PacketAudience,
  type PacketSection,
} from "./packet.js";

const KIND_ORDER: DeliverableRecord["kind"][] = [
  "legal-memo",
  "contract-review",
  "litigation-outline",
  "demand-letter",
  "client-brief",
  "evidence-timeline",
  "general-document",
];

const KIND_TITLES: Record<DeliverableRecord["kind"], string> = {
  "legal-memo": "法律意见",
  "contract-review": "合同审查",
  "litigation-outline": "诉讼方案",
  "demand-letter": "律师函",
  "client-brief": "客户说明",
  "evidence-timeline": "证据与时间线",
  "general-document": "其他文书",
};

const AUDIENCE_LABEL: Record<PacketAudience, string> = {
  client: "客户包",
  court: "法院包",
  opposing: "对方包",
  internal: "内部包",
};

/** 成果物受众 → 包受众；`unknown` 不限制受众（但默认不作为 required）。 */
function packetAudiencesFor(audience: DeliverableRecord["audience"]): PacketAudience[] | undefined {
  switch (audience) {
    case "internal":
      return ["internal"];
    case "client":
      return ["client"];
    case "court":
      return ["court"];
    case "counterparty":
      return ["opposing"];
    default:
      return undefined;
  }
}

function isDeliveredStatus(status: DeliverableRecord["status"]): boolean {
  return status === "approved" || status === "rendered" || status === "delivered";
}

export type PacketSeedSkip = {
  deliverableId: string;
  reason: "no_document" | "document_missing" | "duplicate_path";
};

export type PacketSeedResult = {
  packet: DeliveryPacket;
  skipped: PacketSeedSkip[];
};

export function seedDeliveryPacketFromDeliverables(
  workspaceDir: string,
  matterId: string,
  opts: { audience?: PacketAudience; title?: string; packetId?: string; at?: string | Date } = {},
): PacketSeedResult {
  const matter = loadMatter(workspaceDir, matterId);
  if (!matter) {
    throw new Error(`matter_not_found:${matterId}`);
  }
  const audience = opts.audience ?? "client";
  const deliverables = listDeliverablesForMatter(workspaceDir, matterId);
  const skipped: PacketSeedSkip[] = [];
  const seenPaths = new Set<string>();
  const byKind = new Map<DeliverableRecord["kind"], DeliveryPacketDocument[]>();

  for (const deliverable of deliverables) {
    if (!deliverable.documentId) {
      skipped.push({ deliverableId: deliverable.deliverableId, reason: "no_document" });
      continue;
    }
    const document = loadMatterDocument(workspaceDir, matterId, deliverable.documentId);
    if (!document) {
      skipped.push({ deliverableId: deliverable.deliverableId, reason: "document_missing" });
      continue;
    }
    const rel = document.relativePath.trim().replace(/\\/g, "/");
    if (seenPaths.has(rel)) {
      skipped.push({ deliverableId: deliverable.deliverableId, reason: "duplicate_path" });
      continue;
    }
    seenPaths.add(rel);
    const audiences = packetAudiencesFor(deliverable.audience);
    const doc: DeliveryPacketDocument = {
      docId: deliverable.deliverableId,
      path: rel,
      title: document.label || KIND_TITLES[deliverable.kind],
      required: isDeliveredStatus(deliverable.status),
      ...(audiences ? { audiences } : {}),
    };
    const list = byKind.get(deliverable.kind) ?? [];
    list.push(doc);
    byKind.set(deliverable.kind, list);
  }

  const sections: PacketSection[] = KIND_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    sectionId: `deliverables:${kind}`,
    kind: kind === "evidence-timeline" ? "evidence_index" : "attachment",
    title: KIND_TITLES[kind],
    documents: byKind.get(kind) ?? [],
  }));

  const packet = createDeliveryPacket({
    matterId,
    ...(opts.packetId ? { packetId: opts.packetId } : {}),
    title: opts.title?.trim() || `${matter.title} · ${AUDIENCE_LABEL[audience]}`,
    audience,
    sections:
      sections.length > 0
        ? sections
        : [
            {
              sectionId: "deliverables:empty",
              kind: "attachment",
              title: "成果物",
              documents: [],
            },
          ],
    at: opts.at,
  });
  return { packet, skipped };
}
