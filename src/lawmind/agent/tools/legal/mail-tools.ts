/**
 * Outbound email tools — after lawyer approval, SMTP/Graph send when account configured.
 * Also read-only inbox/attachment listing for chat short-path (no sync).
 */

import { randomUUID } from "node:crypto";
import { resolveLawMindRoot } from "../../../assistants/store.js";
import { isValidMatterId } from "../../../cases/matter-id.js";
import {
  applyMailSendFormat,
  resolveMailAccountForMatter,
  resolveOutboundAttachmentPaths,
  sendMailViaAccount,
} from "../../../mail/index.js";
import {
  commitOutboundMail,
  listMatterMailMessages,
  queueOutboundMail,
  saveAutomationInboxItem,
  toWorkspaceMailAttachmentPath,
  type AutomationInboxItem,
} from "../../../platform/lawyer-automations.js";
import type { AgentTool } from "../../types.js";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveMatterId(params: Record<string, unknown>, ctx: { matterId?: string }): string {
  const fromArgs = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
  return fromArgs || ctx.matterId?.trim() || "";
}

function applyMatterMailFormat(workspaceDir: string, matterId: string, body: string): string {
  const account = resolveMailAccountForMatter(workspaceDir, matterId);
  return applyMailSendFormat(body, account?.sendFormat);
}

/** List local matter mailbox messages (after sync / seed). Does not sync remote mail. */
export const listMailInbox: AgentTool = {
  definition: {
    name: "list_mail_inbox",
    description:
      "列出本案本地邮件匣（cases/<matterId>/mail/inbox）。只读，不远程同步。若需拉新信，请律师在「自动办件 → 邮箱配置」同步，或使用邮件合同审阅短路径。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（可从上下文继承）" },
      limit: { type: "number", description: "最多返回条数，默认 20" },
    },
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx);
    if (!isValidMatterId(matterId)) {
      return { ok: false, error: "matter_id 无效。请先在工作台选中案件。" };
    }
    const limitRaw = typeof params.limit === "number" ? params.limit : 20;
    const limit = Math.min(50, Math.max(1, Math.floor(limitRaw)));
    const messages = listMatterMailMessages(ctx.workspaceDir, matterId)
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        subject: m.subject,
        receivedAt: m.receivedAt,
        attachmentCount: m.attachments.length,
        attachmentNames: m.attachments.map((a) => a.name),
        bodyPreview: m.bodyText.slice(0, 240),
      }));
    return {
      ok: true,
      data: {
        matterId,
        count: messages.length,
        messages,
        hint:
          messages.length === 0
            ? "邮件匣为空。请在「设置 → 自动办件 → 邮箱配置」同步，或写入演示邮件后再试。"
            : "若要做合同改稿，选中附件路径后走短路径（analyze → update_draft → render_tracked_draft → prepare_outbound_mail），勿反复 search_workspace。",
      },
    };
  },
};

/** List attachment workspace-relative paths for one or all local inbox messages. */
export const listMailAttachments: AgentTool = {
  definition: {
    name: "list_mail_attachments",
    description:
      "列出本案邮件附件的工作区相对路径（可用于 contract_edit_baseline_path）。只读。可选 message_id 限定单封。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID（可从上下文继承）" },
      message_id: { type: "string", description: "可选：只列该邮件的附件" },
    },
    riskLevel: "low",
  },
  async execute(params, ctx) {
    const matterId = resolveMatterId(params, ctx);
    if (!isValidMatterId(matterId)) {
      return { ok: false, error: "matter_id 无效。请先在工作台选中案件。" };
    }
    const messageId = typeof params.message_id === "string" ? params.message_id.trim() : "";
    let messages = listMatterMailMessages(ctx.workspaceDir, matterId);
    if (messageId) {
      messages = messages.filter((m) => m.id === messageId);
      if (messages.length === 0) {
        return { ok: false, error: `未找到 message_id=${messageId} 的本地邮件。` };
      }
    }
    const attachments: Array<{
      messageId: string;
      subject: string;
      name: string;
      matterRelativePath?: string;
      workspaceRelativePath: string;
    }> = [];
    for (const m of messages) {
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
          matterRelativePath: a.relativePath,
          workspaceRelativePath,
        });
      }
    }
    return {
      ok: true,
      data: {
        matterId,
        count: attachments.length,
        attachments,
        hint:
          attachments.length > 0
            ? "请用返回的 workspaceRelativePath 作为 contract_edit_baseline_path，禁止再 search_workspace。"
            : "无附件。请先同步邮箱或确认来信含合同文件。",
      },
    };
  },
};

export const sendEmail: AgentTool = {
  definition: {
    name: "send_email",
    description:
      "向客户或对方发送邮件。必须先获得律师批准（在「待我拍板」中处理，批准后服务端自动放行）。已配置邮箱时走 SMTP/Graph，并归档到本案 mail/sent。可选 attachment_paths（工作区相对路径）。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID", required: true },
      to: { type: "string", description: "收件人邮箱", required: true },
      subject: { type: "string", description: "主题", required: true },
      body: { type: "string", description: "正文", required: true },
      attachment_paths: {
        type: "array",
        description: "工作区相对路径附件列表（如 artifacts/xxx.tracked.docx）",
      },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    const matterId = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
    const to = typeof params.to === "string" ? params.to.trim() : "";
    const subject = typeof params.subject === "string" ? params.subject.trim() : "";
    const body = typeof params.body === "string" ? params.body.trim() : "";
    const attachmentRelativePaths = asStringArray(params.attachment_paths);
    if (!isValidMatterId(matterId)) {
      return { ok: false, error: "matter_id 无效。" };
    }
    if (!to || !subject) {
      return { ok: false, error: "to 与 subject 必填。" };
    }
    if (attachmentRelativePaths.length > 0) {
      const resolved = resolveOutboundAttachmentPaths(ctx.workspaceDir, attachmentRelativePaths);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
    }
    // 批准旗标只认服务端注入的布尔 true（模型自填副本已在 turn 边界剥除）。
    const approved = params.__approved === true;
    const payload = {
      to,
      subject,
      body: applyMatterMailFormat(ctx.workspaceDir, matterId, body),
      attachmentRelativePaths,
    };
    if (!approved) {
      const queued = queueOutboundMail(ctx.workspaceDir, matterId, payload);
      return {
        ok: false,
        error: `发送邮件需律师批准。已写入 outbox/${queued}；请在待我拍板中批准，批准后将继续发送。`,
      };
    }
    const sentId = commitOutboundMail(ctx.workspaceDir, matterId, payload);
    const lawMindRoot = resolveLawMindRoot(ctx.workspaceDir, ctx.envFile);
    const remote = await sendMailViaAccount(ctx.workspaceDir, lawMindRoot, matterId, payload);
    return {
      ok: true,
      data: {
        sentId,
        to,
        subject,
        attachmentRelativePaths,
        path: `cases/${matterId}/mail/sent/${sentId}.json`,
        remote,
      },
    };
  },
};

/**
 * Queue outbound mail + attachments into automation inbox for lawyer approve_send.
 * Does not send.
 */
export const prepareOutboundMail: AgentTool = {
  definition: {
    name: "prepare_outbound_mail",
    description:
      "将待发邮件（可含审阅稿附件）写入交办「待拍板」，供律师批准发送。不会真正发信。用于邮件合同审阅改稿 handoff。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID", required: true },
      to: { type: "string", description: "收件人邮箱", required: true },
      subject: { type: "string", description: "主题", required: true },
      body: { type: "string", description: "正文", required: true },
      attachment_paths: {
        type: "array",
        description: "工作区相对路径附件（通常为 artifacts/*.tracked.docx）",
      },
      draft_task_id: { type: "string", description: "关联正文草稿 taskId（可选）" },
      title: { type: "string", description: "待拍板标题（可选）" },
    },
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const matterId = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
    const to = typeof params.to === "string" ? params.to.trim() : "";
    const subject = typeof params.subject === "string" ? params.subject.trim() : "";
    const body = typeof params.body === "string" ? params.body.trim() : "";
    const attachmentRelativePaths = asStringArray(params.attachment_paths);
    const draftTaskId =
      typeof params.draft_task_id === "string" ? params.draft_task_id.trim() : undefined;
    const title =
      typeof params.title === "string" && params.title.trim()
        ? params.title.trim()
        : "邮件合同审阅稿 · 待批准外发";
    if (!isValidMatterId(matterId)) {
      return { ok: false, error: "matter_id 无效。" };
    }
    if (!to || !subject) {
      return { ok: false, error: "to 与 subject 必填。" };
    }
    if (attachmentRelativePaths.length > 0) {
      const resolved = resolveOutboundAttachmentPaths(ctx.workspaceDir, attachmentRelativePaths);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error };
      }
    }
    const formattedBody = applyMatterMailFormat(ctx.workspaceDir, matterId, body);
    const item: AutomationInboxItem = {
      id: randomUUID(),
      automationId: "mail-contract-redline-handoff",
      matterId,
      title,
      summary: [
        `待发：${to}`,
        `主题：${subject}`,
        attachmentRelativePaths.length
          ? `附件：${attachmentRelativePaths.join("、")}`
          : "附件：（无）",
        "",
        "律师批准前不会发送。可在文书台核对审阅痕迹后，于交办待拍板点击「批准发送」。",
      ].join("\n"),
      status: "open",
      createdAt: new Date().toISOString(),
      draftTaskId,
      pendingSend: {
        to,
        subject,
        body: formattedBody,
        attachmentRelativePaths:
          attachmentRelativePaths.length > 0 ? attachmentRelativePaths : undefined,
      },
    };
    saveAutomationInboxItem(ctx.workspaceDir, item);
    queueOutboundMail(ctx.workspaceDir, matterId, {
      to,
      subject,
      body: formattedBody,
      attachmentRelativePaths,
    });
    return {
      ok: true,
      data: {
        inboxId: item.id,
        matterId,
        to,
        subject,
        attachmentRelativePaths,
        message: "已写入待拍板，等待律师批准发送。",
      },
    };
  },
};
