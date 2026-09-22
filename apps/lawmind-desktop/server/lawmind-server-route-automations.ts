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
import {
  validateAutomationConfirmations,
} from "../../../src/lawmind/platform/lawyer-automations.js";
import {
  AUTOMATION_RUN_RETENTION,
  assessAutomationPromotion,
  listAutomationRuns,
  summarizeAutomationRuns,
} from "../../../src/lawmind/platform/automation-run-history.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("daily"),
    hour: z.coerce.number().int().min(0).max(23),
    minute: z.coerce.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("weekly"),
    weekday: z.coerce.number().int().min(0).max(6),
    hour: z.coerce.number().int().min(0).max(23),
    minute: z.coerce.number().int().min(0).max(59),
  }),
  z.object({
    kind: z.literal("once"),
    runAt: z.string().min(1),
  }),
  z.object({
    kind: z.literal("interval"),
    everyMinutes: z.coerce.number().int().min(5).max(7 * 24 * 60),
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
  // 六确认：字段在 zod 层可选（老客户端不会带），门禁在处理器里给出律师可读的拒绝。
  expectedResult: z.string().trim().max(500).optional(),
  approvalBoundary: z.string().trim().max(500).optional(),
  missingDataPolicy: z.enum(["report_failure", "report_partial", "skip_run"]).optional(),
  notifyPolicy: z.enum(["always", "on_problem", "never"]).optional(),
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
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/automations/presets" && req.method === "GET") {
    sendJson(res, 200, { ok: true, presets: AUTOMATION_PRESETS }, c);
    return true;
  }

  const runsMatch = pathname.match(/^\/api\/automations\/([^/]+)\/runs$/);
  if (runsMatch && req.method === "GET") {
    let automationId: string;
    try {
      automationId = decodeURIComponent(runsMatch[1] ?? "");
    } catch {
      sendJsonError(res, 400, "invalid_id", "自动办件 ID 格式不正确。", c);
      return true;
    }
    if (!getAutomation(workspaceDir, automationId)) {
      sendJsonError(res, 404, "not_found", "自动办件不存在。", c);
      return true;
    }
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw
      ? Math.min(100, Math.max(1, Math.floor(Number(limitRaw)) || AUTOMATION_RUN_RETENTION))
      : AUTOMATION_RUN_RETENTION;
    const runs = listAutomationRuns(workspaceDir, automationId, limit);
    sendJson(
      res,
      200,
      {
        ok: true,
        runs,
        // 统计与准入判断一并给出：「这个常设工作靠不靠得住」不该让 UI 自己推。
        stats: summarizeAutomationRuns(runs),
        promotion: assessAutomationPromotion(runs),
      },
      c,
    );
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
    // 常设工作六确认：无人值守的东西必须先把「办完是什么样 / 哪里必须停 / 缺资料怎么办 /
    // 什么时候打扰我」交代清楚，否则出问题时律师无从判断它该不该继续跑。
    // 只拦显式新建（设置页那条路）；「说一句话就交办」走 from-instruction，不在这里设卡。
    const confirmations = validateAutomationConfirmations(body);
    if (!confirmations.ok) {
      sendJsonError(
        res,
        400,
        "automation_confirmations_missing",
        confirmations.message,
        c,
        { missing: confirmations.missing },
      );
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
    // 假数据注入口：仅开发/演示显式开启（LAWMIND_MAIL_SEED=1），打包/生产默认 403。
    if (process.env.LAWMIND_MAIL_SEED !== "1") {
      sendJsonError(
        res,
        403,
        "mail_seed_disabled",
        "演示邮件注入口默认关闭；仅在开发/演示环境设置 LAWMIND_MAIL_SEED=1 后可用。",
        c,
      );
      return true;
    }
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
        sendJsonError(res, 404, "not_found", "自动办件不存在。", c);
        return true;
      }
      sendJson(res, 200, { ok: true, automation }, c);
      return true;
    }
    if (req.method === "PATCH") {
      const existing = getAutomation(workspaceDir, id);
      if (!existing) {
        sendJsonError(res, 404, "not_found", "自动办件不存在。", c);
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
        sendJsonError(res, 404, "not_found", "自动办件不存在。", c);
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
      // 状态区分「远程已发出」与「仅本地归档」——approved_send 的旧语义会误导为已外发成功。
      item.status = remote.ok ? "sent_remote" : "approved_local_only";
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
