/**
 * Mail account configuration + sync/test API (used from 交办 page).
 */

import {
  MAIL_PROVIDER_PRESETS,
  deleteMailAccount,
  getMailAccount,
  listPublicMailAccounts,
  saveMailAccount,
  syncMailAccountToMatter,
  testMailAccountConnection,
  toPublicMailAccount,
  upsertMailAccount,
  type MailProviderId,
} from "../../../src/lawmind/mail/index.js";
import {
  listMatterMailMessages,
  toWorkspaceMailAttachmentPath,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { loadMatter } from "../../../src/lawmind/adapters/matter-storage/index.js";
import { hydrateMatterParties } from "../../../src/lawmind/desk/matter-parties.js";
import {
  acceptIntakeLead,
  acknowledgeAdmissionDisclosures,
  addAdmissionCandidates,
  assignAdmissionOwner,
  attachIntakeItem,
  beginConflictScan,
  checkAdmissionGate,
  createAdmission,
  decideAdmission,
  detachIntakeItem,
  ensureIntakeDropzone,
  getIntakeItem,
  ignoreIntakeItem,
  listAdmissions,
  listIntakeItems,
  loadAdmission,
  loadEngagementPackage,
  readIntakeEvents,
  readIntakeBlob,
  recordConflictScan,
  restoreIntakeItem,
  runIntakeTick,
  scanAdmissionConflicts,
  setIntakeLeadStage,
  setIntakeTranscriptSegmentText,
  setIntakeTranscriptSpeakerLabel,
  setIntakeTranscriptSpeakerParty,
  transcribeIntakeRecording,
  isIntakeAudioFile,
  writeEngagementPackage,
  exportEngagementPackageDocx,
  applyIntakeFieldsFromItem,
  applyIntakeFieldProvenance,
  listMissingProvenance,
  loadFieldProvenance,
  evaluateWorkspaceMatching,
} from "../../../src/lawmind/intake/index.js";
import {
  AdmissionCandidateSchema,
  AdmissionConflictHitSchema,
  AdmissionStatusSchema,
} from "../../../src/lawmind/intake/admission.js";
import { EngagementPackageInputSchema } from "../../../src/lawmind/intake/engagement-package.js";
import { FieldProvenanceInputSchema } from "../../../src/lawmind/intake/field-provenance.js";
import { extractLegalEvents } from "../../../src/lawmind/desk/legal-event-extract.js";
import { applyLegalEvents } from "../../../src/lawmind/desk/desk-apply.js";
import {
  acknowledgeEthicsWall,
  readEthicsWallState,
} from "../../../src/lawmind/policy/ethics-wall.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import { resolveDesktopActorId, sendJson } from "./lawmind-server-helpers.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { z } from "zod";
import { IntakeKeySchema } from "../../../src/lawmind/intake/types.js";

const providerEnum = z.enum(["gmail", "outlook", "microsoft365", "qq", "163", "imap"]);

const watchContactSchema = z.object({
  email: z.string().trim().email(),
  label: z.string().trim().min(1).max(80),
  note: z.string().trim().max(200).optional(),
});

const sendFormatSchema = z.object({
  fromName: z.string().max(80).optional(),
  closingStyle: z.enum(["none", "formal", "business", "reply", "custom"]).optional(),
  customClosing: z.string().max(200).optional(),
  signature: z.string().max(2000).optional(),
  appendIfMissing: z.boolean().optional(),
});

const upsertSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().max(120).optional(),
  provider: providerEnum,
  email: z.string().trim().email(),
  authKind: z.enum(["password", "app_password", "graph_client"]).optional(),
  imapHost: z.string().trim().max(200).optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  smtpHost: z.string().trim().max(200).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  allowInsecure: z.boolean().optional(),
  matterId: z.string().trim().nullable().optional(),
  /** 收案邮箱进入统一收件库，不能绑定为某一个案件的默认邮箱。 */
  intakeInbox: z.boolean().optional(),
  tenantId: z.string().trim().max(120).optional(),
  clientId: z.string().trim().max(120).optional(),
  graphMailbox: z.string().trim().max(200).optional(),
  watchContacts: z.array(watchContactSchema).max(40).optional(),
  sendFormat: sendFormatSchema.nullable().optional(),
  enabled: z.boolean().optional(),
  password: z.string().max(500).optional(),
  clientSecret: z.string().max(500).optional(),
});

const syncSchema = z.object({
  matterId: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  force: z.boolean().optional(),
});

const intakeSyncSchema = z.object({
  accountId: z.string().trim().min(1).optional(),
  force: z.boolean().optional(),
});

const intakeListSchema = z.enum(["pending", "attached", "ignored"]);

const intakeSpeakerLabelSchema = z.object({
  speaker: z.string().trim().min(1).max(40),
  label: z.string().trim().max(40),
});

const intakeSpeakerPartySchema = z.object({
  speaker: z.string().trim().min(1).max(40),
  matterId: z.string().trim().min(1).max(128),
  partyId: z.string().trim().max(64),
});

const intakeTranscriptSegmentSchema = z.object({
  index: z.number().int().min(0).max(1999),
  text: z.string().trim().min(1).max(4000),
});

const INTAKE_AUDIO_CONTENT_TYPE: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".wma": "audio/x-ms-wma",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
};

/**
 * 可内联预览的附件类型。HTML / SVG 故意排除：它们是可执行文档，
 * 用内联渲染等于让来件在应用里执行脚本；一律按 octet-stream 下载。
 */
const INTAKE_ATTACHMENT_CONTENT_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

function intakePreview(item: ReturnType<typeof getIntakeItem>) {
  if (!item) {
    return null;
  }
  return {
    ...item,
    text: item.text.slice(0, 2000),
    // 分段可能很多；预览接口只回前 500 段，完整转写仍在条目里。
    ...(item.transcript
      ? {
          transcript: {
            ...item.transcript,
            segments: item.transcript.segments.slice(0, 500),
          },
        }
      : {}),
  };
}

export async function handleMailRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);

  if (pathname === "/api/intake/dropzone" && req.method === "GET") {
    sendJson(res, 200, { ok: true, path: ensureIntakeDropzone(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/intake/matching-eval" && req.method === "GET") {
    sendJson(res, 200, { ok: true, report: evaluateWorkspaceMatching(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/intake/matter-parties" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const record = matterId && isValidMatterId(matterId) ? loadMatter(workspaceDir, matterId) : undefined;
    if (!record) {
      sendJsonError(res, 404, "not_found", "案件不存在。", c);
      return true;
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        parties: hydrateMatterParties(record).map((party) => ({
          partyId: party.partyId,
          name: party.name,
          role: party.role,
          ...(party.standing ? { standing: party.standing } : {}),
        })),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/intake/items" && req.method === "GET") {
    const rawStatus = url.searchParams.get("status")?.trim();
    const statuses = rawStatus
      ? rawStatus.split(",").map((value) => intakeListSchema.parse(value))
      : undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50;
    sendJson(
      res,
      200,
      {
        ok: true,
        items: listIntakeItems(workspaceDir, { statuses, limit }).map(intakePreview),
      },
      c,
    );
    return true;
  }

  const intakeItemMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)$/);
  if (intakeItemMatch && req.method === "GET") {
    const item = getIntakeItem(workspaceDir, decodeURIComponent(intakeItemMatch[1] ?? ""));
    if (!item) {
      sendJsonError(res, 404, "not_found", "收件条目不存在。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, item: intakePreview(item) }, c);
    return true;
  }

  const audioMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/audio$/);
  if (audioMatch && (req.method === "GET" || req.method === "HEAD")) {
    const item = getIntakeItem(workspaceDir, decodeURIComponent(audioMatch[1] ?? ""));
    if (!item) {
      sendJsonError(res, 404, "not_found", "收件条目不存在。", c);
      return true;
    }
    const attachment = item.attachments.find((row) => row.sha256 && isIntakeAudioFile(row.name));
    const audio = attachment?.sha256 ? readIntakeBlob(workspaceDir, attachment.sha256) : undefined;
    if (!attachment || !audio) {
      sendJsonError(res, 404, "not_found", "这条来件没有可播放的音频原件。", c);
      return true;
    }
    const ext = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    const contentType = INTAKE_AUDIO_CONTENT_TYPE[ext] ?? "application/octet-stream";
    const total = audio.length;
    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const requestedEnd = match[2] ? Number(match[2]) : total - 1;
      const end = Math.min(requestedEnd, total - 1);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        start > end ||
        start >= total
      ) {
        res.writeHead(416, { "content-range": `bytes */${total}`, ...c });
        res.end();
        return true;
      }
      res.writeHead(206, {
        "content-type": contentType,
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        ...c,
      });
      res.end(req.method === "HEAD" ? undefined : audio.subarray(start, end + 1));
      return true;
    }
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": total,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      ...c,
    });
    res.end(req.method === "HEAD" ? undefined : audio);
    return true;
  }

  // 附件原件：只按条目里登记的下标取，不接受路径；预览类型内联，其它一律下载。
  const attachmentMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/attachments\/(\d+)$/);
  if (attachmentMatch && (req.method === "GET" || req.method === "HEAD")) {
    const item = getIntakeItem(workspaceDir, decodeURIComponent(attachmentMatch[1] ?? ""));
    if (!item) {
      sendJsonError(res, 404, "not_found", "收件条目不存在。", c);
      return true;
    }
    const index = Number(attachmentMatch[2]);
    const attachment = Number.isInteger(index) ? item.attachments[index] : undefined;
    if (!attachment) {
      sendJsonError(res, 404, "not_found", "这条来件没有这个附件。", c);
      return true;
    }
    const bytes = attachment.sha256 ? readIntakeBlob(workspaceDir, attachment.sha256) : undefined;
    if (!bytes) {
      sendJsonError(res, 404, "not_found", "附件原件不在收件库里。", c);
      return true;
    }
    const ext = attachment.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
    const contentType = INTAKE_ATTACHMENT_CONTENT_TYPE[ext] ?? "application/octet-stream";
    const inline = contentType !== "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": bytes.length,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...c,
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
    return true;
  }

  const legalEventsMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/legal-events$/);
  if (legalEventsMatch && req.method === "GET") {
    const item = getIntakeItem(workspaceDir, decodeURIComponent(legalEventsMatch[1] ?? ""));
    if (!item) {
      sendJsonError(res, 404, "not_found", "收件条目不存在。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, events: extractLegalEvents(item.text) }, c);
    return true;
  }

  const transcribeMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/transcribe$/);
  if (transcribeMatch && req.method === "POST") {
    const itemId = decodeURIComponent(transcribeMatch[1] ?? "");
    if (!getIntakeItem(workspaceDir, itemId)) {
      sendJsonError(res, 404, "not_found", "收件条目不存在。", c);
      return true;
    }
    const forceParam = url.searchParams.get("force");
    const force = forceParam === "1" || forceParam === "true";
    const result = await transcribeIntakeRecording(workspaceDir, itemId, { force });
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "no_config" || result.reason === "offline"
            ? 409
            : 400;
      sendJson(res, status, { ok: false, reason: result.reason, error: result.error }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, chars: result.chars, via: result.via }, c);
    return true;
  }

  const speakersMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/speakers$/);
  if (speakersMatch && req.method === "POST") {
    const itemId = decodeURIComponent(speakersMatch[1] ?? "");
    let body;
    try {
      body = await parseJsonBodyZod(req, intakeSpeakerLabelSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = setIntakeTranscriptSpeakerLabel(
      workspaceDir,
      itemId,
      body.speaker,
      body.label,
    );
    if (!result.ok) {
      const status =
        result.reason === "not_found" ? 404 : result.reason === "no_transcript" ? 409 : 400;
      sendJson(res, status, { ok: false, reason: result.reason }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, item: intakePreview(result.item) }, c);
    return true;
  }

  const speakerPartiesMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/speaker-parties$/);
  if (speakerPartiesMatch && req.method === "POST") {
    const itemId = decodeURIComponent(speakerPartiesMatch[1] ?? "");
    let body;
    try {
      body = await parseJsonBodyZod(req, intakeSpeakerPartySchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = setIntakeTranscriptSpeakerParty(
      workspaceDir,
      itemId,
      body.speaker,
      body.partyId ? { matterId: body.matterId, partyId: body.partyId } : null,
    );
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "no_transcript"
            ? 409
            : 400;
      sendJson(res, status, { ok: false, reason: result.reason }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, item: intakePreview(result.item) }, c);
    return true;
  }

  const transcriptSegmentMatch = pathname.match(
    /^\/api\/intake\/items\/([^/]+)\/transcript-segments$/,
  );
  if (transcriptSegmentMatch && req.method === "POST") {
    const itemId = decodeURIComponent(transcriptSegmentMatch[1] ?? "");
    let body;
    try {
      body = await parseJsonBodyZod(req, intakeTranscriptSegmentSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = setIntakeTranscriptSegmentText(workspaceDir, itemId, body.index, body.text);
    if (!result.ok) {
      const status =
        result.reason === "not_found"
          ? 404
          : result.reason === "no_transcript"
            ? 409
            : 400;
      sendJson(res, status, { ok: false, reason: result.reason }, c);
      return true;
    }
    sendJson(res, 200, { ok: true, item: intakePreview(result.item) }, c);
    return true;
  }

  if (pathname === "/api/intake/events" && req.method === "GET") {
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100;
    sendJson(res, 200, { ok: true, events: readIntakeEvents(workspaceDir, { limit }) }, c);
    return true;
  }

  if (pathname === "/api/intake/sync" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, intakeSyncSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = await runIntakeTick(workspaceDir, lawMindRoot, {
      accountId: body.accountId,
      force: body.force ?? true,
    });
    const rows = result?.mail ?? [];
    const failed = rows.find((row) => ! row.ok);
    sendJson(
      res,
      200,
      {
        // 单个收案邮箱失败时，顶层 ok 不能还是 true：否则界面会把失败当成功。
        ok: !failed,
        result: result ?? { mail: [] },
        ...(failed && ! failed.ok
          ? { error: failed.error, hint: failed.hint, accountId: failed.accountId }
          : {}),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/intake/items/attach" && req.method === "POST") {
    const body = await parseJsonBodyZod(
      req,
      z.object({
        itemId: z.string().min(1),
        matterId: z.string().min(1),
        keys: z.array(IntakeKeySchema).max(12).optional(),
        rememberSenderAs: z.object({ partyId: z.string().min(1) }).optional(),
        /** 记住发件人为本案委托人的已核验邮箱，下次同址来信可直接判案。 */
        rememberSender: z.boolean().optional(),
      }),
    );
    const result = attachIntakeItem(workspaceDir, body.itemId, body.matterId, {
      by: "lawyer",
      keys: body.keys,
      rememberSenderAs: body.rememberSenderAs,
      rememberSender: body.rememberSender,
    });
    if (result.ok) {
      // 与 lead.accept、收案邮箱自动归案一致：归案后按出处规则补空字段。
      // 抽取是附加动作，失败不回滚已经成功的归档。
      let provenance: Awaited<ReturnType<typeof applyIntakeFieldsFromItem>> | undefined;
      try {
        provenance = await applyIntakeFieldsFromItem(workspaceDir, body.matterId, body.itemId);
      } catch {
        provenance = undefined;
      }
      sendJson(res, 200, { ...result, ...(provenance ? { provenance } : {}) }, c);
    } else {
      sendJson(res, 400, result, c);
    }
    return true;
  }

  // ── 收案记录（P1.1）：扫描 / 告知 / 负责人 / 接受或婉拒 ──────────────────
  if (pathname === "/api/intake/admissions" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(
        req,
        z.object({
          matterId: z.string().trim().min(1).max(128),
          ownerLawyerId: z.string().trim().min(1).max(120).optional(),
        }),
      );
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = createAdmission(workspaceDir, {
      matterId: body.matterId,
      ownerLawyerId: body.ownerLawyerId ?? resolveDesktopActorId(),
    });
    if (!result.ok && result.error === "matter_not_found") {
      sendJsonError(res, 404, "matter_not_found", "案件不存在，不能建立收案记录。", c);
      return true;
    }
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  if (pathname === "/api/intake/admissions" && req.method === "GET") {
    const rawStatus = url.searchParams.get("status")?.trim();
    const statuses = rawStatus
      ? rawStatus.split(",").map((value) => AdmissionStatusSchema.parse(value))
      : undefined;
    const limitRaw = Number(url.searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
      : 100;
    sendJson(res, 200, { ok: true, admissions: listAdmissions(workspaceDir, { statuses, limit }) }, c);
    return true;
  }

  const engagementMatch = pathname.match(/^\/api\/intake\/admissions\/([^/]+)\/engagement$/);
  if (engagementMatch) {
    const matterId = decodeURIComponent(engagementMatch[1] ?? "");
    if (!loadAdmission(workspaceDir, matterId)) {
      sendJsonError(res, 404, "admission_not_found", "先建立收案记录，再生成委托包。", c);
      return true;
    }
    if (req.method === "GET") {
      const manifest = loadEngagementPackage(workspaceDir, matterId);
      if (!manifest) {
        sendJsonError(res, 404, "not_found", "还没有生成委托包。", c);
        return true;
      }
      sendJson(res, 200, { ok: true, manifest }, c);
      return true;
    }
    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBodyZod(
          req,
          EngagementPackageInputSchema.extend({ overwrite: z.boolean().optional() }),
        );
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }
      const { overwrite, ...input } = body;
      const result = await writeEngagementPackage(workspaceDir, matterId, input, { overwrite });
      if (!result.ok) {
        const status =
          result.error === "matter_not_found"
            ? 404
            : result.error === "exists"
              ? 409
              : 400;
        sendJson(res, status, result, c);
        return true;
      }
      sendJson(res, 200, result, c);
      return true;
    }
  }

  const engagementDocxMatch = pathname.match(
    /^\/api\/intake\/admissions\/([^/]+)\/engagement\/docx$/,
  );
  if (engagementDocxMatch) {
    const matterId = decodeURIComponent(engagementDocxMatch[1] ?? "");
    if (req.method !== "POST") {
      sendJsonError(res, 405, "method_not_allowed", "导出委托包 DOCX 只接受 POST。", c);
      return true;
    }
    if (!loadAdmission(workspaceDir, matterId)) {
      sendJsonError(res, 404, "admission_not_found", "先建立收案记录，再生成委托包。", c);
      return true;
    }
    let body: { overwrite?: boolean };
    try {
      body = await parseJsonBodyZod(req, z.object({ overwrite: z.boolean().optional() }));
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (!loadEngagementPackage(workspaceDir, matterId)) {
      sendJson(res, 404, { ok: false, error: "package_not_found" }, c);
      return true;
    }
    const result = await exportEngagementPackageDocx(workspaceDir, matterId, {
      overwrite: body?.overwrite === true,
    });
    if (!result.ok) {
      const status =
        result.error === "package_not_found"
          ? 404
          : result.error === "exists"
            ? 409
            : result.error === "render_failed" || result.error === "write_failed"
              ? 500
              : 400;
      sendJson(res, status, result, c);
      return true;
    }
    sendJson(res, 200, result, c);
    return true;
  }

  const provenanceMatch = pathname.match(/^\/api\/intake\/admissions\/([^/]+)\/provenance$/);
  if (provenanceMatch) {
    const matterId = decodeURIComponent(provenanceMatch[1] ?? "");
    if (!loadAdmission(workspaceDir, matterId)) {
      sendJsonError(res, 404, "admission_not_found", "先建立收案记录，再记录字段出处。", c);
      return true;
    }
    if (req.method === "GET") {
      const file = loadFieldProvenance(workspaceDir, matterId);
      sendJson(
        res,
        200,
        {
          ok: true,
          entries: file?.entries ?? [],
          coverage: listMissingProvenance(workspaceDir, matterId),
        },
        c,
      );
      return true;
    }
    if (req.method === "POST") {
      let body;
      try {
        body = await parseJsonBodyZod(
          req,
          z.object({
            itemId: z.string().trim().min(1).max(64).optional(),
            fields: z.array(FieldProvenanceInputSchema).max(32).optional(),
          }),
        );
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }
      if (!body.itemId) {
        sendJsonError(res, 400, "invalid_body", "itemId 必填。", c);
        return true;
      }
      const result = body.fields
        ? await applyIntakeFieldProvenance(workspaceDir, matterId, {
            itemId: body.itemId,
            fields: body.fields,
          })
        : await applyIntakeFieldsFromItem(workspaceDir, matterId, body.itemId);
      sendJson(res, result.ok ? 200 : 400, result, c);
      return true;
    }
  }

  const legalEventsConfirmMatch = pathname.match(
    /^\/api\/intake\/admissions\/([^/]+)\/legal-events$/,
  );
  if (legalEventsConfirmMatch && req.method === "POST") {
    const matterId = decodeURIComponent(legalEventsConfirmMatch[1] ?? "");
    if (!loadAdmission(workspaceDir, matterId)) {
      sendJsonError(res, 404, "admission_not_found", "先建立收案记录，再写入期限。", c);
      return true;
    }
    let body;
    try {
      body = await parseJsonBodyZod(
        req,
        z.object({
          events: z
            .array(
              z.object({
                eventKind: z.enum([
                  "hearing",
                  "filing",
                  "limitation",
                  "reply",
                  "preservation",
                  "custom",
                ]),
                title: z.string().trim().min(1).max(120),
                dueAt: z.string().trim().min(1).max(40),
                notes: z.string().trim().max(1000).optional(),
              }),
            )
            .min(1)
            .max(20),
        }),
      );
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const result = await applyLegalEvents(workspaceDir, matterId, body.events);
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  const admissionMatch = pathname.match(/^\/api\/intake\/admissions\/([^/]+)$/);
  if (admissionMatch && req.method === "GET") {
    const matterId = decodeURIComponent(admissionMatch[1] ?? "");
    const admission = loadAdmission(workspaceDir, matterId);
    if (!admission) {
      sendJsonError(res, 404, "not_found", "收案记录不存在。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, admission, gate: checkAdmissionGate(workspaceDir, matterId) }, c);
    return true;
  }

  if (admissionMatch && req.method === "POST") {
    const matterId = decodeURIComponent(admissionMatch[1] ?? "");
    let body;
    try {
      body = await parseJsonBodyZod(
        req,
        z.object({
          action: z.enum([
            "assign",
            "add_candidates",
            "scan_start",
            "scan",
            "scan_run",
            "acknowledge",
            "accept",
            "decline",
          ]),
          ownerLawyerId: z.string().trim().min(1).max(120).optional(),
          hits: z.array(AdmissionConflictHitSchema).max(50).optional(),
          candidates: z.array(AdmissionCandidateSchema).max(32).optional(),
          risk: z.boolean().optional(),
          ai: z.boolean().optional(),
          note: z.string().trim().max(500).optional(),
          overrideReason: z.string().trim().max(500).optional(),
        }),
      );
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const actor = resolveDesktopActorId();
    let result;
    switch (body.action) {
      case "assign":
        result = assignAdmissionOwner(workspaceDir, matterId, {
          ownerLawyerId: body.ownerLawyerId ?? actor,
          by: actor,
        });
        break;
      case "add_candidates":
        result = addAdmissionCandidates(workspaceDir, matterId, {
          candidates: body.candidates ?? [],
          by: actor,
        });
        break;
      case "scan_start":
        result = beginConflictScan(workspaceDir, matterId, { by: actor, note: body.note });
        break;
      case "scan":
        result = recordConflictScan(workspaceDir, matterId, {
          hits: body.hits ?? [],
          by: actor,
          note: body.note,
        });
        break;
      case "scan_run":
        result = await scanAdmissionConflicts(workspaceDir, matterId, { by: actor });
        break;
      case "acknowledge":
        result = acknowledgeAdmissionDisclosures(workspaceDir, matterId, {
          risk: body.risk,
          ai: body.ai,
          by: actor,
        });
        break;
      case "accept":
        result = decideAdmission(workspaceDir, matterId, {
          decision: "accept",
          by: actor,
          note: body.note,
          overrideReason: body.overrideReason,
        });
        break;
      case "decline":
        result = decideAdmission(workspaceDir, matterId, {
          decision: "decline",
          by: actor,
          note: body.note,
        });
        break;
    }
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  const intakeLeadMatch = pathname.match(/^\/api\/intake\/items\/([^/]+)\/lead$/);
  if (intakeLeadMatch && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(
        req,
        z.object({
          action: z.enum(["new", "needs_info", "conflict_pending", "declined", "accept"]),
          /** 进入收案时的案件名称（同时作为案件目录名）。 */
          matterTitle: z.string().trim().max(128).optional(),
          note: z.string().trim().max(500).optional(),
        }),
      );
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    const itemId = decodeURIComponent(intakeLeadMatch[1] ?? "");
    if (body.action === "accept") {
      const result = acceptIntakeLead(workspaceDir, itemId, body.matterTitle ?? "", {
        ownerLawyerId: resolveDesktopActorId(),
      });
      if (result.ok && result.item.lead?.matterId) {
        // 收案后立刻把能确定核对的字段（案号、对方）写进卷宗并记出处。
        // 抽取失败不回滚收案：律师仍可以在档案里手填。
        const provenance = await applyIntakeFieldsFromItem(
          workspaceDir,
          result.item.lead.matterId,
          itemId,
        );
        sendJson(res, 200, { ...result, provenance }, c);
      } else {
        sendJson(res, result.ok ? 200 : 400, result, c);
      }
      return true;
    }
    const result = setIntakeLeadStage(workspaceDir, itemId, body.action, { note: body.note });
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  const intakeActionMatch = pathname.match(
    /^\/api\/intake\/items\/([^/]+)\/(ignore|restore|detach)$/,
  );
  if (intakeActionMatch && req.method === "POST") {
    const itemId = decodeURIComponent(intakeActionMatch[1] ?? "");
    const action = intakeActionMatch[2];
    const result =
      action === "ignore"
        ? ignoreIntakeItem(workspaceDir, itemId)
        : action === "restore"
          ? restoreIntakeItem(workspaceDir, itemId)
          : detachIntakeItem(workspaceDir, itemId, { forgetSender: false });
    sendJson(res, result.ok ? 200 : 400, result, c);
    return true;
  }

  if (pathname === "/api/ethics-wall" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    if (!isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    sendJson(res, 200, { ok: true, state: readEthicsWallState(workspaceDir, matterId) }, c);
    return true;
  }

  if (pathname === "/api/ethics-wall/acknowledge" && req.method === "POST") {
    const body = await parseJsonBodyZod(req, z.object({ matterId: z.string().trim().min(1) }));
    const matterId = body.matterId.trim();
    if (!isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const state = acknowledgeEthicsWall({
      workspaceDir,
      matterId,
      actorId: resolveDesktopActorId(),
    });
    sendJson(res, 200, { ok: true, state }, c);
    return true;
  }

  if (pathname === "/api/mail/providers" && req.method === "GET") {
    sendJson(res, 200, { ok: true, providers: MAIL_PROVIDER_PRESETS }, c);
    return true;
  }

  const matterAttachmentsMatch = pathname.match(
    /^\/api\/mail\/matters\/([^/]+)\/attachments$/,
  );
  if (matterAttachmentsMatch && req.method === "GET") {
    const matterId = decodeURIComponent(matterAttachmentsMatch[1] ?? "");
    if (!isValidMatterId(matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const attachments: Array<{
      messageId: string;
      subject: string;
      name: string;
      workspaceRelativePath: string;
    }> = [];
    for (const m of listMatterMailMessages(workspaceDir, matterId)) {
      for (const a of m.attachments) {
        const workspaceRelativePath = toWorkspaceMailAttachmentPath(
          matterId,
          a.relativePath,
          a.name,
        );
        if (!workspaceRelativePath) {
          continue;
        }
        attachments.push({
          messageId: m.id,
          subject: m.subject,
          name: a.name,
          workspaceRelativePath,
        });
      }
    }
    sendJson(
      res,
      200,
      {
        ok: true,
        matterId,
        messages: listMatterMailMessages(workspaceDir, matterId).slice(0, 40),
        attachments,
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/mail/accounts" && req.method === "GET") {
    sendJson(
      res,
      200,
      { ok: true, accounts: listPublicMailAccounts(workspaceDir, lawMindRoot) },
      c,
    );
    return true;
  }

  if (pathname === "/api/mail/accounts" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, upsertSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (body.matterId && !isValidMatterId(body.matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    try {
      const account = upsertMailAccount(workspaceDir, lawMindRoot, {
        id: body.id,
        label: body.label,
        provider: body.provider as MailProviderId,
        email: body.email,
        authKind: body.authKind,
        imapHost: body.imapHost,
        imapPort: body.imapPort,
        smtpHost: body.smtpHost,
        smtpPort: body.smtpPort,
        smtpSecure: body.smtpSecure,
        allowInsecure: body.allowInsecure,
        matterId: body.intakeInbox === true ? null : body.matterId,
        intakeInbox: body.intakeInbox,
        tenantId: body.tenantId,
        clientId: body.clientId,
        graphMailbox: body.graphMailbox,
        watchContacts: body.watchContacts,
        sendFormat: body.sendFormat,
        enabled: body.enabled,
        secret: {
          password: body.password,
          clientSecret: body.clientSecret,
        },
      });
      sendJson(
        res,
        body.id ? 200 : 201,
        { ok: true, account: toPublicMailAccount(lawMindRoot, account) },
        c,
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : "upsert_failed";
      const hints: Record<string, string> = {
        invalid_email: "请填写有效邮箱地址。",
        unsupported_auth_kind: "该邮箱类型不支持所选登录方式。",
        imap_host_required: "自定义 IMAP 需填写主机。",
        graph_tenant_client_required: "Graph 方式需填写租户 ID 与客户端 ID。",
      };
      sendJsonError(res, 400, code, hints[code] || code, c);
    }
    return true;
  }

  const accountMatch = pathname.match(/^\/api\/mail\/accounts\/([^/]+)(?:\/(test|sync))?$/);
  if (accountMatch) {
    const id = decodeURIComponent(accountMatch[1] ?? "");
    const action = accountMatch[2];

    if (!action && req.method === "DELETE") {
      if (!deleteMailAccount(workspaceDir, lawMindRoot, id)) {
        sendJsonError(res, 404, "not_found", "邮箱账号不存在。", c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }

    if (action === "test" && req.method === "POST") {
      const account = getMailAccount(workspaceDir, id);
      if (!account) {
        sendJsonError(res, 404, "not_found", "邮箱账号不存在。", c);
        return true;
      }
      const result = await testMailAccountConnection(account, lawMindRoot);
      const next = {
        ...account,
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        updatedAt: new Date().toISOString(),
      };
      saveMailAccount(workspaceDir, next);
      if (!result.ok) {
        sendJson(
          res,
          200,
          {
            ok: false,
            error: result.error,
            hint: result.hint,
            account: toPublicMailAccount(lawMindRoot, next),
          },
          c,
        );
        return true;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          mailbox: result.mailbox,
          messageCount: result.messageCount,
          account: toPublicMailAccount(lawMindRoot, next),
        },
        c,
      );
      return true;
    }

    if (action === "sync" && req.method === "POST") {
      let body;
      try {
        body = await parseJsonBodyZod(req, syncSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }
      if (!body.matterId || !isValidMatterId(body.matterId)) {
        sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
        return true;
      }
      const result = await syncMailAccountToMatter(
        workspaceDir,
        lawMindRoot,
        id,
        body.matterId,
        { limit: body.limit },
      );
      const account = getMailAccount(workspaceDir, id);
      sendJson(
        res,
        200,
        {
          ...result,
          account: account ? toPublicMailAccount(lawMindRoot, account) : null,
        },
        c,
      );
      return true;
    }
  }

  return false;
}
