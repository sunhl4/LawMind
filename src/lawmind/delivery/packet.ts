/**
 * DeliveryPacket 清单生成：读文件、算 sha256、求值启用条件、生成整包哈希。
 *
 * 浏览器安全的常量/类型/纯函数在 `packet-model.ts`；这里依赖 `node:*`，只给引擎与本地服务用。
 *
 * 关键约束：
 * - 包内文件顺序、文件哈希、封面（标题）、受众、分节标题都进 `packetHash`；
 *   任一变化都让之前的批准失效。
 * - 缺 required 文档是 blocker（不能发送）；缺可选文档是 warning（可发送但必须显示）。
 * - 跨案件文件直接拒绝：`cases/<other>/...`、`matters/<other>/...` 不得混入。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PACKET_SCHEMA_VERSION,
  type DeliveryPacket,
  type DeliveryPacketDocument,
  type PacketAudience,
  type PacketCondition,
  type PacketManifest,
  type PacketManifestEntry,
  type PacketManifestFile,
  type PacketManifestSection,
  type PacketRenderContext,
} from "./packet-model.js";

export * from "./packet-model.js";

function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

const MATTER_SCOPED_PATH = /^(?:cases|matters)\/([^/]+)\//;

/** 路径安全检查：绝对路径、`..`、空路径一律拒绝。 */
function pathProblem(raw: string): string | undefined {
  const rel = normalizeRel(raw);
  if (!rel) {
    return "文件路径为空。";
  }
  if (rel.startsWith("/") || /^[A-Za-z]:\//.test(rel) || rel.startsWith("\\\\")) {
    return `不接受绝对路径：${raw}`;
  }
  if (rel.split("/").some((segment) => segment === "..")) {
    return `路径不得包含 ..：${raw}`;
  }
  if (rel.includes("\0")) {
    return "路径包含非法字符。";
  }
  return undefined;
}

/** `cases/<id>/...` / `matters/<id>/...` 必须属于本包案件；其它工作区路径放行。 */
function crossMatterPath(raw: string, matterId: string): boolean {
  const rel = normalizeRel(raw);
  const match = MATTER_SCOPED_PATH.exec(rel);
  return Boolean(match && match[1] !== matterId);
}

function conditionAllows(
  condition: PacketCondition | undefined,
  ctx: PacketRenderContext,
): boolean | undefined {
  if (!condition) {
    return undefined;
  }
  switch (condition.kind) {
    case "audience_in":
      return condition.audiences.includes(ctx.audience);
    case "stage_in":
      return Boolean(ctx.stage && condition.stages.includes(ctx.stage));
    case "party_role_present": {
      const want = condition.role.trim().toLowerCase();
      return (ctx.partyRoles ?? []).some((role) => role.trim().toLowerCase() === want);
    }
    default:
      return false;
  }
}

function audienceAllows(doc: DeliveryPacketDocument, audience: PacketAudience): boolean {
  if (!doc.audiences || doc.audiences.length === 0) {
    return true;
  }
  return doc.audiences.includes(audience);
}

function iso(at?: string | Date): string {
  if (!at) {
    return new Date().toISOString();
  }
  return typeof at === "string" ? at : at.toISOString();
}

/**
 * 建包清单：求值启用条件、校验路径与文件、计算哈希。
 * 不写盘、不改包；同一输入同一时刻之外应得到同一 hash（`generatedAt` 不进哈希）。
 */
export function buildPacketManifest(
  workspaceDir: string,
  packet: DeliveryPacket,
  ctx: PacketRenderContext = { audience: packet.audience },
  opts: { at?: string | Date } = {},
): PacketManifest {
  const generatedAt = iso(opts.at);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const files: PacketManifestFile[] = [];
  const seenPaths = new Set<string>();

  const sections: PacketManifestSection[] = packet.sections.map((section) => {
    const documents: PacketManifestEntry[] = section.documents.map((doc) => {
      const rel = normalizeRel(doc.path);
      const base: PacketManifestEntry = {
        docId: doc.docId,
        path: rel,
        ...(doc.title ? { title: doc.title } : {}),
        required: doc.required === true,
        included: false,
      };
      const unsafe = pathProblem(rel);
      if (unsafe) {
        blockers.push(unsafe);
        return { ...base, excludedReason: "unsafe_path" };
      }
      if (crossMatterPath(rel, packet.matterId)) {
        blockers.push(`包内混入了其它案件的文件：${rel}`);
        return { ...base, excludedReason: "cross_matter" };
      }
      if (!audienceAllows(doc, ctx.audience)) {
        return { ...base, excludedReason: "audience" };
      }
      const condition = conditionAllows(doc.enabledWhen, ctx);
      if (condition === false) {
        return { ...base, excludedReason: "condition" };
      }
      if (seenPaths.has(rel)) {
        warnings.push(`同一文件在包内重复：${rel}，只保留第一次出现。`);
        return { ...base, excludedReason: "duplicate" };
      }
      seenPaths.add(rel);

      const abs = path.resolve(workspaceDir, rel);
      let content: Buffer;
      try {
        content = fs.readFileSync(abs);
      } catch {
        if (base.required) {
          blockers.push(`缺少必需文件：${rel}${doc.title ? `（${doc.title}）` : ""}`);
        } else {
          warnings.push(`可选文件缺失：${rel}${doc.title ? `（${doc.title}）` : ""}`);
        }
        return { ...base, excludedReason: "missing" };
      }
      const sha256Value = sha256(content);
      const entry: PacketManifestEntry = {
        ...base,
        included: true,
        sha256: sha256Value,
        bytes: content.byteLength,
      };
      files.push({
        order: files.length + 1,
        sectionId: section.sectionId,
        docId: doc.docId,
        path: rel,
        ...(doc.title ? { title: doc.title } : {}),
        sha256: sha256Value,
        bytes: content.byteLength,
      });
      return entry;
    });
    return {
      sectionId: section.sectionId,
      kind: section.kind,
      title: section.title,
      documents,
    };
  });

  if (files.length === 0) {
    blockers.push("交付包没有任何可交付文件。");
  }

  const manifest: PacketManifest = {
    schemaVersion: PACKET_SCHEMA_VERSION,
    packetId: packet.packetId,
    matterId: packet.matterId,
    title: packet.title,
    audience: ctx.audience,
    sections,
    files,
    ...(packet.output ? { output: packet.output } : {}),
    blockers,
    warnings,
    packetHash: "",
    generatedAt,
  };
  manifest.packetHash = computePacketHash(manifest);
  return manifest;
}

/**
 * 整包指纹：覆盖分节顺序、文件顺序、每份文件的 sha256、封面标题与受众。
 * `output`（合并/打包）与 `generatedAt` 不进哈希：它们不改变「批准的是哪些内容」。
 */
export function computePacketHash(manifest: PacketManifest): string {
  return stableHash({
    schemaVersion: manifest.schemaVersion,
    packetId: manifest.packetId,
    matterId: manifest.matterId,
    title: manifest.title,
    audience: manifest.audience,
    sections: manifest.sections.map((section) => ({
      sectionId: section.sectionId,
      kind: section.kind,
      title: section.title,
      documents: section.documents.map((doc) => ({
        docId: doc.docId,
        path: doc.path,
        title: doc.title,
        required: doc.required,
        included: doc.included,
        excludedReason: doc.excludedReason,
        sha256: doc.sha256,
        bytes: doc.bytes,
      })),
    })),
    files: manifest.files.map((file) => ({
      order: file.order,
      sectionId: file.sectionId,
      docId: file.docId,
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
  });
}
