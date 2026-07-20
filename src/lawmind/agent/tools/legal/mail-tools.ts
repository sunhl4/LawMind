/**
 * Outbound email tool — after lawyer approval, SMTP/Graph send when account configured.
 */

import { resolveLawMindRoot } from "../../../assistants/store.js";
import { isValidMatterId } from "../../../cases/matter-id.js";
import { sendMailViaAccount } from "../../../mail/index.js";
import { commitOutboundMail, queueOutboundMail } from "../../../platform/lawyer-automations.js";
import type { AgentTool } from "../../types.js";

export const sendEmail: AgentTool = {
  definition: {
    name: "send_email",
    description:
      "向客户或对方发送邮件。必须先获得律师批准（__approved: true）。已配置邮箱时走 SMTP/Graph，并归档到本案 mail/sent。",
    category: "system",
    parameters: {
      matter_id: { type: "string", description: "案件 ID", required: true },
      to: { type: "string", description: "收件人邮箱", required: true },
      subject: { type: "string", description: "主题", required: true },
      body: { type: "string", description: "正文", required: true },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    const matterId = typeof params.matter_id === "string" ? params.matter_id.trim() : "";
    const to = typeof params.to === "string" ? params.to.trim() : "";
    const subject = typeof params.subject === "string" ? params.subject.trim() : "";
    const body = typeof params.body === "string" ? params.body.trim() : "";
    if (!isValidMatterId(matterId)) {
      return { ok: false, error: "matter_id 无效。" };
    }
    if (!to || !subject) {
      return { ok: false, error: "to 与 subject 必填。" };
    }
    const approved = params.__approved === true || params.__approved === "true";
    if (!approved) {
      const queued = queueOutboundMail(ctx.workspaceDir, matterId, { to, subject, body });
      return {
        ok: false,
        error: `发送邮件需律师批准。已写入 outbox/${queued}；请在待我拍板中批准后重试并传 __approved: true。`,
      };
    }
    const sentId = commitOutboundMail(ctx.workspaceDir, matterId, { to, subject, body });
    const lawMindRoot = resolveLawMindRoot(ctx.workspaceDir, ctx.envFile);
    const remote = await sendMailViaAccount(ctx.workspaceDir, lawMindRoot, matterId, {
      to,
      subject,
      body,
    });
    return {
      ok: true,
      data: {
        sentId,
        to,
        subject,
        path: `cases/${matterId}/mail/sent/${sentId}.json`,
        remote,
      },
    };
  },
};
