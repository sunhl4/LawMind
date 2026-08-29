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
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";
import { z } from "zod";

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
  matterId: z.string().trim().nullable().optional(),
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
  matterId: z.string().trim().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function handleMailRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir, envFile } = ctx;
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);

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
        matterId: body.matterId,
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
      if (!isValidMatterId(body.matterId)) {
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
