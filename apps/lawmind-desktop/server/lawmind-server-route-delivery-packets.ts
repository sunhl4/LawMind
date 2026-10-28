/**
 * 交付包路由（桌面本地 API）。
 *
 *   GET    /api/matters/:matterId/delivery-packets
 *   POST   /api/matters/:matterId/delivery-packets          { action: "seed" | "save", ... }
 *   DELETE /api/matters/:matterId/delivery-packets/:packetId
 *   GET    /api/matters/:matterId/delivery-packets/:packetId/export?format=zip|individual|merged_pdf
 *
 * 清单每次请求重新求值并重算 `packetHash`，不返回缓存的旧批准结果。
 */

import { z } from "zod";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import {
  DeliveryPacketSchema,
  PacketAudienceSchema,
  buildPacketManifest,
  type DeliveryPacket,
  type PacketAudience,
  type PacketRenderContext,
} from "../../../src/lawmind/delivery/packet.js";
import { exportDeliveryPacket } from "../../../src/lawmind/delivery/packet-export.js";
import { seedDeliveryPacketFromDeliverables } from "../../../src/lawmind/delivery/packet-seed.js";
import {
  deleteDeliveryPacket,
  listDeliveryPackets,
  saveDeliveryPacket,
} from "../../../src/lawmind/delivery/packet-store.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import { sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const BASE_RE = /^\/api\/matters\/([^/]+)\/delivery-packets$/;
const ONE_RE = /^\/api\/matters\/([^/]+)\/delivery-packets\/([^/]+)$/;
const EXPORT_RE = /^\/api\/matters\/([^/]+)\/delivery-packets\/([^/]+)\/export$/;

const saveBodySchema = z.object({
  action: z.literal("save"),
  packet: DeliveryPacketSchema,
});
const seedBodySchema = z.object({
  action: z.literal("seed"),
  audience: PacketAudienceSchema.optional(),
  title: z.string().trim().max(200).optional(),
});
const postBodySchema = z.discriminatedUnion("action", [saveBodySchema, seedBodySchema]);

function decodeSegment(raw: string | undefined): string {
  return decodeURIComponent(raw ?? "").trim();
}

function renderContext(
  packetAudience: PacketAudience,
  audienceQuery: string | null,
  stageQuery: string | null,
  rolesQuery: string | null,
): PacketRenderContext {
  const parsedAudience = PacketAudienceSchema.safeParse(audienceQuery);
  return {
    audience: parsedAudience.success ? parsedAudience.data : packetAudience,
    ...(stageQuery?.trim() ? { stage: stageQuery.trim() } : {}),
    ...(rolesQuery?.trim()
      ? { partyRoles: rolesQuery.split(",").map((role) => role.trim()).filter(Boolean) }
      : {}),
  };
}

function manifestFor(workspaceDir: string, packet: DeliveryPacket, ctx: PacketRenderContext) {
  return buildPacketManifest(workspaceDir, packet, ctx);
}

export async function handleDeliveryPacketRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const exportMatch = EXPORT_RE.exec(pathname);
  if (exportMatch) {
    const matterId = decodeSegment(exportMatch[1]);
    const packetId = decodeSegment(exportMatch[2]);
    if (req.method !== "GET") {
      return false;
    }
    if (!isValidMatterId(matterId) || !packetId) {
      sendJsonError(res, 400, "invalid_fields", "缺少有效的案件或交付包 ID。", c);
      return true;
    }
    const packet = listDeliveryPackets(ctx.workspaceDir, matterId).find(
      (item) => item.packetId === packetId,
    );
    if (!packet) {
      sendJsonError(res, 404, "packet_not_found", "未找到该交付包。", c);
      return true;
    }
    const formatRaw = url.searchParams.get("format") ?? "zip";
    if (formatRaw !== "zip" && formatRaw !== "individual" && formatRaw !== "merged_pdf") {
      sendJsonError(res, 400, "invalid_format", "format 须为 zip、individual 或 merged_pdf。", c);
      return true;
    }
    const context = renderContext(
      packet.audience,
      url.searchParams.get("audience"),
      url.searchParams.get("stage"),
      url.searchParams.get("partyRoles"),
    );
    const manifest = manifestFor(ctx.workspaceDir, packet, context);
    const result = await exportDeliveryPacket(ctx.workspaceDir, manifest, formatRaw);
    if (!result.ok) {
      if (result.reason === "blocked") {
        sendJson(
          res,
          409,
          { ok: false, error: "packet_blocked", message: result.message, blockers: result.blockers },
          c,
        );
        return true;
      }
      if (result.reason === "pdf_failed") {
        sendJson(res, 500, { ok: false, error: result.reason, message: result.message }, c);
        return true;
      }
      sendJson(res, 400, { ok: false, error: result.reason, message: result.message }, c);
      return true;
    }
    if (result.format === "individual") {
      sendJson(
        res,
        200,
        { ok: true, format: "individual", packetHash: manifest.packetHash, files: result.files },
        c,
      );
      return true;
    }
    res.writeHead(200, {
      "content-type": result.contentType,
      "content-length": String(result.content.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      ...c,
    });
    res.end(result.content);
    return true;
  }

  const oneMatch = ONE_RE.exec(pathname);
  if (oneMatch) {
    const matterId = decodeSegment(oneMatch[1]);
    const packetId = decodeSegment(oneMatch[2]);
    if (!isValidMatterId(matterId) || !packetId) {
      sendJsonError(res, 400, "invalid_fields", "缺少有效的案件或交付包 ID。", c);
      return true;
    }
    if (req.method === "DELETE") {
      const removed = deleteDeliveryPacket(ctx.workspaceDir, matterId, packetId);
      if (!removed) {
        sendJsonError(res, 404, "packet_not_found", "未找到该交付包。", c);
        return true;
      }
      sendJson(res, 200, { ok: true, deleted: packetId }, c);
      return true;
    }
    return false;
  }

  const baseMatch = BASE_RE.exec(pathname);
  if (!baseMatch) {
    return false;
  }
  const matterId = decodeSegment(baseMatch[1]);
  if (!isValidMatterId(matterId)) {
    sendJson(res, 400, { ok: false, error: "invalid_matter_id" }, c);
    return true;
  }

  if (req.method === "GET") {
    const packets = listDeliveryPackets(ctx.workspaceDir, matterId);
    const views = packets.map((packet) => {
      const context = renderContext(
        packet.audience,
        url.searchParams.get("audience"),
        url.searchParams.get("stage"),
        url.searchParams.get("partyRoles"),
      );
      const manifest = manifestFor(ctx.workspaceDir, packet, context);
      return {
        packet,
        manifest: {
          audience: manifest.audience,
          packetHash: manifest.packetHash,
          blockers: manifest.blockers,
          warnings: manifest.warnings,
          files: manifest.files,
          sections: manifest.sections,
          readiness: manifest.blockers.length === 0 ? "ready" : "blocked",
        },
      };
    });
    sendJson(res, 200, { ok: true, matterId, packets: views }, c);
    return true;
  }

  if (req.method === "POST") {
    let body: z.infer<typeof postBodySchema>;
    try {
      body = await parseJsonBodyZod(req, postBodySchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_body", issues: err.issues }, c);
        return true;
      }
      throw err;
    }
    if (body.action === "save") {
      if (body.packet.matterId !== matterId) {
        sendJsonError(res, 400, "matter_mismatch", "交付包不属于该案件。", c);
        return true;
      }
      const saved = saveDeliveryPacket(ctx.workspaceDir, {
        ...body.packet,
        updatedAt: new Date().toISOString(),
      });
      const manifest = manifestFor(ctx.workspaceDir, saved, {
        audience: saved.audience,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          packet: saved,
          packetHash: manifest.packetHash,
          blockers: manifest.blockers,
          warnings: manifest.warnings,
        },
        c,
      );
      return true;
    }
    try {
      const seeded = seedDeliveryPacketFromDeliverables(ctx.workspaceDir, matterId, {
        ...(body.audience ? { audience: body.audience } : {}),
        ...(body.title ? { title: body.title } : {}),
      });
      const saved = saveDeliveryPacket(ctx.workspaceDir, seeded.packet);
      const manifest = manifestFor(ctx.workspaceDir, saved, { audience: saved.audience });
      sendJson(
        res,
        200,
        {
          ok: true,
          packet: saved,
          skipped: seeded.skipped,
          packetHash: manifest.packetHash,
          blockers: manifest.blockers,
          warnings: manifest.warnings,
        },
        c,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("matter_not_found")) {
        sendJsonError(res, 404, "matter_not_found", "未找到该案件。", c);
        return true;
      }
      throw err;
    }
  }

  return false;
}
