/**
 * Lawyer Automations HTTP API — CRUD + presets + inbox + approve-send.
 */

import {
  AUTOMATION_PRESETS,
  commitOutboundMail,
  createAutomation,
  deleteAutomation,
  getAutomation,
  getAutomationInboxItem,
  inferAutomationFromInstruction,
  listAutomations,
  listOpenAutomationInbox,
  listMatterMailMessages,
  sanitizeNotifyEmail,
  saveAutomation,
  saveAutomationInboxItem,
  computeNextRunAt,
  type AutomationPresetId,
  type AutomationSchedule,
  writeMatterMailMessage,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { sendMailViaAccount } from "../../../src/lawmind/mail/index.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

const scheduleSchema = z.union([
  z.object({
    kind: z.literal("daily"),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("once"),
    runAt: z.string().min(1),
  }),
]);

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  presetId: z.enum([
    "renewal-monitor",
    "client-weekly-update",
    "mail-inbox-digest",
    "mail-contract-review",
    "custom",
  ]),
  matterId: z.string().trim().min(1),
  instruction: z.string().trim().max(4000).optional(),
  schedule: scheduleSchema.optional(),
  enabled: z.boolean().optional(),
  allowSendEmailAfterApproval: z.boolean().optional(),
  notifyEmail: z.string().trim().max(320).optional(),
});

const customSchema = z.object({
  matterId: z.string().trim().min(1),
  instruction: z.string().trim().min(1).max(4000),
  schedule: scheduleSchema.optional(),
  allowSendEmailAfterApproval: z.boolean().optional(),
  notifyEmail: z.string().trim().max(320).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  enabled: z.boolean().optional(),
  schedule: scheduleSchema.optional(),
  instruction: z.string().trim().max(4000).optional(),
  allowSendEmailAfterApproval: z.boolean().optional(),
  notifyEmail: z.string().trim().max(320).nullable().optional(),
  runNow: z.boolean().optional(),
});

const inboxActionSchema = z.object({
  action: z.enum(["acknowledge", "dismiss", "approve_send"]),
});

const seedMailSchema = z.object({
  matterId: z.string().trim().min(1),
  from: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1),
  bodyText: z.string().trim().optional(),
  attachments: z
    .array(z.object({ name: z.string(), relativePath: z.string() }))
    .optional(),
});

export async function handleAutomationsRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/automations/presets" && req.method === "GET") {
    sendJson(res, 200, { ok: true, presets: AUTOMATION_PRESETS }, c);
    return true;
  }

  if (pathname === "/api/automations" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        ok: true,
        automations: listAutomations(workspaceDir),
        inbox: listOpenAutomationInbox(workspaceDir),
      },
      c,
    );
    return true;
  }

  if (pathname === "/api/automations" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, createSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (!isValidMatterId(body.matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const automation = createAutomation(workspaceDir, {
      ...body,
      presetId: body.presetId as AutomationPresetId,
      schedule: body.schedule as AutomationSchedule | undefined,
    });
    sendJson(res, 201, { ok: true, automation }, c);
    return true;
  }

  if (pathname === "/api/automations/from-instruction" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, customSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (!isValidMatterId(body.matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const inferred = inferAutomationFromInstruction(body.instruction);
    const automation = createAutomation(workspaceDir, {
      matterId: body.matterId,
      presetId: inferred.presetId,
      title: inferred.title,
      instruction: inferred.instruction,
      schedule: body.schedule as AutomationSchedule | undefined,
      allowSendEmailAfterApproval:
        body.allowSendEmailAfterApproval ?? inferred.allowSendEmailAfterApproval,
      notifyEmail: body.notifyEmail,
    });
    sendJson(res, 201, { ok: true, automation, inferred }, c);
    return true;
  }

  if (pathname === "/api/automations/mail/seed" && req.method === "POST") {
    let body;
    try {
      body = await parseJsonBodyZod(req, seedMailSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (!isValidMatterId(body.matterId)) {
      sendJsonError(res, 400, "invalid_matter_id", "案件 ID 格式不正确。", c);
      return true;
    }
    const id = `seed-${Date.now()}`;
    writeMatterMailMessage(workspaceDir, body.matterId, {
      id,
      from: body.from ?? "对方 <counterparty@example.com>",
      to: "lawyer@example.com",
      subject: body.subject,
      receivedAt: new Date().toISOString(),
      bodyText: body.bodyText ?? "",
      attachments: body.attachments ?? [],
    });
    sendJson(
      res,
      201,
      {
        ok: true,
        messageId: id,
        messages: listMatterMailMessages(workspaceDir, body.matterId).slice(0, 20),
      },
      c,
    );
    return true;
  }

  const autoMatch = pathname.match(/^\/api\/automations\/([^/]+)$/);
  if (autoMatch) {
    const id = decodeURIComponent(autoMatch[1] ?? "");
    if (req.method === "GET") {
      const automation = getAutomation(workspaceDir, id);
      if (!automation) {
        sendJsonError(res, 404, "not_found", "交办任务不存在。", c);
        return true;
      }
      sendJson(res, 200, { ok: true, automation }, c);
      return true;
    }
    if (req.method === "PATCH") {
      const existing = getAutomation(workspaceDir, id);
      if (!existing) {
        sendJsonError(res, 404, "not_found", "交办任务不存在。", c);
        return true;
      }
      let body;
      try {
        body = await parseJsonBodyZod(req, patchSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
          return true;
        }
        throw err;
      }
      const schedule = (body.schedule as AutomationSchedule | undefined) ?? existing.schedule;
      let nextRunAt = existing.nextRunAt;
      if (body.schedule) {
        nextRunAt = computeNextRunAt(schedule);
      }
      if (body.runNow) {
        nextRunAt = new Date(0).toISOString();
      }
      const notifyEmail =
        body.notifyEmail === null
          ? undefined
          : body.notifyEmail !== undefined
            ? sanitizeNotifyEmail(body.notifyEmail)
            : existing.notifyEmail;
      const updated = {
        ...existing,
        title: body.title?.trim() || existing.title,
        enabled: body.enabled ?? existing.enabled,
        schedule,
        instruction:
          body.instruction !== undefined ? body.instruction.trim() || undefined : existing.instruction,
        allowSendEmailAfterApproval:
          body.allowSendEmailAfterApproval ?? existing.allowSendEmailAfterApproval,
        notifyEmail,
        nextRunAt,
        updatedAt: new Date().toISOString(),
      };
      saveAutomation(workspaceDir, updated);
      sendJson(res, 200, { ok: true, automation: updated }, c);
      return true;
    }
    if (req.method === "DELETE") {
      if (!deleteAutomation(workspaceDir, id)) {
        sendJsonError(res, 404, "not_found", "交办任务不存在。", c);
        return true;
      }
      sendJson(res, 200, { ok: true }, c);
      return true;
    }
  }

  const inboxMatch = pathname.match(/^\/api\/automations\/inbox\/([^/]+)\/action$/);
  if (inboxMatch && req.method === "POST") {
    const inboxId = decodeURIComponent(inboxMatch[1] ?? "");
    const item = getAutomationInboxItem(workspaceDir, inboxId);
    if (!item) {
      sendJsonError(res, 404, "not_found", "拍板项不存在。", c);
      return true;
    }
    let body;
    try {
      body = await parseJsonBodyZod(req, inboxActionSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }
    if (body.action === "approve_send") {
      if (!item.pendingSend) {
        sendJsonError(res, 400, "no_pending_send", "该项没有待发送邮件。", c);
        return true;
      }
      const sentId = commitOutboundMail(workspaceDir, item.matterId, item.pendingSend);
      const lawMindRoot = resolveLawMindRoot(workspaceDir, ctx.envFile);
      const remote = await sendMailViaAccount(
        workspaceDir,
        lawMindRoot,
        item.matterId,
        item.pendingSend,
      );
      item.status = "approved_send";
      if (remote.ok) {
        item.summary = `${item.summary}\n\n已批准并通过 ${remote.via} 发送（归档 sent/${sentId}）。`;
      } else {
        item.summary = `${item.summary}\n\n已批准并写入本地 sent/${sentId}；远程发信未成功：${remote.hint || remote.error}。请检查「交办 → 邮箱配置」。`;
      }
      saveAutomationInboxItem(workspaceDir, item);
      sendJson(res, 200, { ok: true, item, sentId, remote }, c);
      return true;
    }
    item.status = body.action === "dismiss" ? "dismissed" : "acknowledged";
    saveAutomationInboxItem(workspaceDir, item);
    sendJson(res, 200, { ok: true, item }, c);
    return true;
  }

  return false;
}
