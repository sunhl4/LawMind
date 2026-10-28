/**
 * DeliveryPacket 的浏览器安全模型：常量、类型、schema、纯函数。
 *
 * 这个文件不能 import `node:*`：桌面 renderer 直接复用它做受众选择与清单展示。
 * 需要读文件、算 sha256 的 `buildPacketManifest()` / `computePacketHash()` 在 `packet.ts`。
 */

import { z } from "zod";

export const PACKET_SCHEMA_VERSION = 1;

export const PACKET_AUDIENCES = ["client", "court", "opposing", "internal"] as const;
export type PacketAudience = (typeof PACKET_AUDIENCES)[number];

export const PACKET_SECTION_KINDS = [
  "cover",
  "opinion",
  "evidence_index",
  "attachment",
  "other",
] as const;
export type PacketSectionKind = (typeof PACKET_SECTION_KINDS)[number];

export const PACKET_OUTPUT_FORMATS = ["merged_pdf", "zip", "individual"] as const;
export type PacketOutputFormat = (typeof PACKET_OUTPUT_FORMATS)[number];

export type PacketOutput = {
  format?: PacketOutputFormat;
  /** 诉讼包的连续页码；客户包通常不需要。 */
  bates?: { prefix?: string; start?: number; pad?: number };
};

/**
 * 渲染时求值的启用条件。建包时只记声明，真正是否进包由 `buildPacketManifest` 决定，
 * 并把求值结果写进 manifest，解释「为什么这份在里面/不在」。
 */
export type PacketCondition =
  | { kind: "audience_in"; audiences: PacketAudience[] }
  | { kind: "stage_in"; stages: string[] }
  | { kind: "party_role_present"; role: string };

export type PacketRenderContext = {
  audience: PacketAudience;
  /** 案件阶段（如 intake / drafted / filed）。 */
  stage?: string;
  /** 本案当事人角色（小写比较）。 */
  partyRoles?: string[];
};

export type DeliveryPacketDocument = {
  docId: string;
  /** 工作区相对路径。 */
  path: string;
  title?: string;
  /** 缺这份就不能交付。 */
  required?: boolean;
  /** 不写 = 所有受众都进。 */
  audiences?: PacketAudience[];
  enabledWhen?: PacketCondition;
};

export type PacketSection = {
  sectionId: string;
  kind: PacketSectionKind;
  title: string;
  documents: DeliveryPacketDocument[];
};

export type DeliveryPacket = {
  schemaVersion: typeof PACKET_SCHEMA_VERSION;
  packetId: string;
  matterId: string;
  /** 封面标题；进哈希。 */
  title: string;
  audience: PacketAudience;
  sections: PacketSection[];
  output?: PacketOutput;
  createdAt: string;
  updatedAt: string;
};

export const PacketAudienceSchema = z.enum(PACKET_AUDIENCES);
export const PacketSectionKindSchema = z.enum(PACKET_SECTION_KINDS);
export const PacketOutputFormatSchema = z.enum(PACKET_OUTPUT_FORMATS);

export const PacketOutputSchema: z.ZodType<PacketOutput> = z.object({
  format: PacketOutputFormatSchema.optional(),
  bates: z
    .object({
      prefix: z.string().max(32).optional(),
      start: z.number().int().nonnegative().optional(),
      pad: z.number().int().positive().max(10).optional(),
    })
    .optional(),
});

export const PacketConditionSchema: z.ZodType<PacketCondition> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("audience_in"), audiences: z.array(PacketAudienceSchema).max(4) }),
  z.object({ kind: z.literal("stage_in"), stages: z.array(z.string().min(1).max(64)).max(24) }),
  z.object({ kind: z.literal("party_role_present"), role: z.string().min(1).max(64) }),
]);

export const DeliveryPacketDocumentSchema: z.ZodType<DeliveryPacketDocument> = z.object({
  docId: z.string().min(1).max(128),
  path: z.string().min(1).max(1024),
  title: z.string().max(200).optional(),
  required: z.boolean().optional(),
  audiences: z.array(PacketAudienceSchema).max(4).optional(),
  enabledWhen: PacketConditionSchema.optional(),
});

export const PacketSectionSchema: z.ZodType<PacketSection> = z.object({
  sectionId: z.string().min(1).max(128),
  kind: PacketSectionKindSchema,
  title: z.string().min(1).max(200),
  documents: z.array(DeliveryPacketDocumentSchema).max(200),
});

export const DeliveryPacketSchema: z.ZodType<DeliveryPacket> = z.object({
  schemaVersion: z.literal(PACKET_SCHEMA_VERSION),
  packetId: z.string().min(1).max(128),
  matterId: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  audience: PacketAudienceSchema,
  sections: z.array(PacketSectionSchema).min(1).max(64),
  output: PacketOutputSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PacketDocumentExclusionReason =
  | "audience"
  | "condition"
  | "missing"
  | "duplicate"
  | "unsafe_path"
  | "cross_matter";

export type PacketManifestEntry = {
  docId: string;
  path: string;
  title?: string;
  required: boolean;
  included: boolean;
  excludedReason?: PacketDocumentExclusionReason;
  /** 文件缺失时也保留路径，便于律师核对。 */
  sha256?: string;
  bytes?: number;
};

export type PacketManifestSection = {
  sectionId: string;
  kind: PacketSectionKind;
  title: string;
  documents: PacketManifestEntry[];
};

export type PacketManifestFile = {
  /** 从 1 开始的交付顺序。 */
  order: number;
  sectionId: string;
  docId: string;
  path: string;
  title?: string;
  sha256: string;
  bytes: number;
};

export type PacketManifest = {
  schemaVersion: typeof PACKET_SCHEMA_VERSION;
  packetId: string;
  matterId: string;
  title: string;
  audience: PacketAudience;
  sections: PacketManifestSection[];
  files: PacketManifestFile[];
  output?: PacketOutput;
  /** 任一非空即不可发送。 */
  blockers: string[];
  /** 可发送但必须向律师显示。 */
  warnings: string[];
  /** 覆盖顺序、文件哈希、封面、受众、分节的整包指纹。 */
  packetHash: string;
  generatedAt: string;
};

export type CreateDeliveryPacketInput = {
  matterId: string;
  title: string;
  audience: PacketAudience;
  sections: PacketSection[];
  packetId?: string;
  output?: PacketOutput;
  at?: string | Date;
};

function iso(at?: string | Date): string {
  if (!at) {
    return new Date().toISOString();
  }
  return typeof at === "string" ? at : at.toISOString();
}

function newPacketId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `pkt_${uuid.replace(/-/g, "").slice(0, 16)}`;
}

export function createDeliveryPacket(input: CreateDeliveryPacketInput): DeliveryPacket {
  const at = iso(input.at);
  return {
    schemaVersion: PACKET_SCHEMA_VERSION,
    packetId: input.packetId?.trim() || newPacketId(),
    matterId: input.matterId,
    title: input.title,
    audience: input.audience,
    sections: input.sections,
    ...(input.output ? { output: input.output } : {}),
    createdAt: at,
    updatedAt: at,
  };
}

export function packetCanSend(manifest: PacketManifest): boolean {
  return manifest.blockers.length === 0;
}

/** 律师面一句话：这个包能不能发、缺什么。 */
export function describePacketReadiness(manifest: PacketManifest): string {
  if (packetCanSend(manifest)) {
    const warnings = manifest.warnings.length ? `；另有 ${manifest.warnings.length} 条提示` : "";
    return `可交付：${manifest.files.length} 份文件，受众 ${manifest.audience}${warnings}。`;
  }
  return `不可交付：${manifest.blockers.join("；")}`;
}

export function findPacketManifestEntry(
  manifest: PacketManifest,
  docId: string,
): PacketManifestEntry | undefined {
  for (const section of manifest.sections) {
    const hit = section.documents.find((doc) => doc.docId === docId);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}
