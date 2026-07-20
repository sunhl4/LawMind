/**
 * Due-automation tick: enqueue workflows, digest mail, push results to automation inbox.
 */

import { randomUUID } from "node:crypto";
import { resolveLawMindRoot } from "../assistants/store.js";
import { syncMatterMailbox } from "../mail/sync-inbox.js";
import {
  buildMailContractReviewSummary,
  buildMailDigestSummary,
  computeNextRunAt,
  createAutomation,
  extractNotifyEmail,
  getAutomation,
  listAutomations,
  listMatterMailMessages,
  sanitizeNotifyEmail,
  saveAutomation,
  saveAutomationInboxItem,
  type LawyerAutomation,
  type AutomationInboxItem,
} from "./lawyer-automations.js";

export type AutomationRunHooks = {
  /** Enqueue a collaboration workflow; return jobId. */
  enqueueTemplate?: (args: {
    templateId: string;
    matterId: string;
    instruction?: string;
    automationId: string;
  }) => string | null | Promise<string | null>;
  /** LawMind root for mail secrets (defaults to parent of workspace). */
  lawMindRoot?: string;
  envFile?: string;
};

function pushInbox(
  workspaceDir: string,
  automation: LawyerAutomation,
  partial: Omit<
    AutomationInboxItem,
    "id" | "automationId" | "matterId" | "status" | "createdAt"
  > & {
    pendingSend?: AutomationInboxItem["pendingSend"];
  },
): AutomationInboxItem {
  const item: AutomationInboxItem = {
    id: randomUUID(),
    automationId: automation.id,
    matterId: automation.matterId,
    title: partial.title,
    summary: partial.summary,
    status: "open",
    createdAt: new Date().toISOString(),
    draftTaskId: partial.draftTaskId,
    jobId: partial.jobId,
    mailMessageIds: partial.mailMessageIds,
    pendingSend: partial.pendingSend,
  };
  saveAutomationInboxItem(workspaceDir, item);
  return item;
}

function resolveNotifyEmail(automation: LawyerAutomation): string | undefined {
  return sanitizeNotifyEmail(automation.notifyEmail) || extractNotifyEmail(automation.instruction);
}

async function runOneAutomation(
  workspaceDir: string,
  automation: LawyerAutomation,
  hooks: AutomationRunHooks,
  now: Date,
): Promise<void> {
  let summary = "";
  let jobId: string | undefined;
  let mailMessageIds: string[] | undefined;
  let pendingSend: AutomationInboxItem["pendingSend"] | undefined;

  if (
    automation.presetId === "mail-inbox-digest" ||
    automation.presetId === "mail-contract-review"
  ) {
    const lawMindRoot =
      hooks.lawMindRoot?.trim() || resolveLawMindRoot(workspaceDir, hooks.envFile);
    let syncNote = "";
    try {
      const sync = await syncMatterMailbox(workspaceDir, lawMindRoot, automation.matterId, {
        limit: 30,
      });
      if ("skipped" in sync && sync.skipped) {
        syncNote =
          "（未配置远程邮箱：请到「交办 → 邮箱配置」连接 Gmail/Outlook/QQ 等后再同步。）\n\n";
      } else if (sync.ok && "written" in sync) {
        const mode =
          sync.watchMode === "contacts" ? `（按对方名单过滤，跳过 ${sync.filteredOut} 封）` : "";
        syncNote = `（已从远程邮箱同步 ${sync.written} 封${mode}）\n\n`;
      } else if (!sync.ok) {
        syncNote = `（远程同步失败：${sync.hint || sync.error}；仍读取本地匣。）\n\n`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      syncNote = `（远程同步异常：${msg.slice(0, 120)}；仍读取本地匣。）\n\n`;
    }
    const messages = listMatterMailMessages(workspaceDir, automation.matterId);
    mailMessageIds = messages.map((m) => m.id);

    if (automation.presetId === "mail-inbox-digest") {
      summary = syncNote + buildMailDigestSummary(messages);
      pushInbox(workspaceDir, automation, {
        title: `${automation.title} · 运行结果`,
        summary,
        mailMessageIds,
      });
    } else {
      const built = buildMailContractReviewSummary(messages);
      summary = syncNote + built.summary;
      if (automation.instruction?.trim()) {
        summary = `${summary}\n\n交办补充：${automation.instruction.trim()}`;
      }
      const templateId = automation.templateId || "contract-review";
      if (built.attachmentNames.length > 0 && hooks.enqueueTemplate) {
        const instruction = [
          "请对本案邮件附件中的合同做初审，输出分章节审查意见与风险等级。",
          built.attachmentNames.length ? `附件清单：${built.attachmentNames.join("、")}` : "",
          automation.instruction?.trim() || "",
        ]
          .filter(Boolean)
          .join("\n");
        const enqueued = await hooks.enqueueTemplate({
          templateId,
          matterId: automation.matterId,
          instruction,
          automationId: automation.id,
        });
        jobId = enqueued ?? undefined;
        summary = jobId
          ? `${summary}\n\n已启动合同审查工作流「${templateId}」（任务 ${jobId.slice(0, 8)}…）。完成后请在「文书台」或「待我拍板」签批。`
          : `${summary}\n\n未能启动工作流「${templateId}」。请确认协作模板存在且案件有效；仍可按附件清单在对话中交办初审。`;
      } else if (built.attachmentNames.length === 0) {
        summary = `${summary}\n\n未启动审查工作流（无合同附件）。`;
      } else {
        summary = `${summary}\n\n（本地未挂载工作流入队钩子，仅生成附件清单。）`;
      }
      pushInbox(workspaceDir, automation, {
        title: `${automation.title} · 运行结果`,
        summary,
        mailMessageIds,
        jobId,
      });
    }
  } else if (
    automation.presetId === "renewal-monitor" ||
    automation.presetId === "client-weekly-update" ||
    (automation.presetId === "custom" && automation.templateId)
  ) {
    const templateId =
      automation.templateId ||
      (automation.presetId === "renewal-monitor"
        ? "renewal-monitor"
        : automation.presetId === "client-weekly-update"
          ? "client-update-memo"
          : undefined);
    if (templateId && hooks.enqueueTemplate) {
      const enqueued = await hooks.enqueueTemplate({
        templateId,
        matterId: automation.matterId,
        instruction: automation.instruction,
        automationId: automation.id,
      });
      jobId = enqueued ?? undefined;
      summary = jobId
        ? `已启动后台工作流「${templateId}」（任务 ${jobId.slice(0, 8)}…）。完成后请在「在办」或「待我拍板」查看。`
        : `未能启动工作流「${templateId}」。请确认协作模板存在且案件有效。`;
    } else {
      summary = automation.instruction?.trim()
        ? `自定义交办已记录：${automation.instruction.trim()}。请到对话中继续处理，或绑定可预约工作流模板。`
        : "交办任务已触发，但未配置可执行模板。";
    }
    const inboxPartial: Parameters<typeof pushInbox>[2] = {
      title: `${automation.title} · 运行结果`,
      summary,
      jobId,
    };
    if (automation.allowSendEmailAfterApproval && automation.presetId === "client-weekly-update") {
      const to = resolveNotifyEmail(automation);
      if (to) {
        pendingSend = {
          to,
          subject: `【${automation.matterId}】本案进展说明`,
          body: `${summary}\n\n（批准后将写入本案 mail/sent，并尝试通过已配置的邮箱账号发送。）`,
        };
        inboxPartial.pendingSend = pendingSend;
      } else {
        inboxPartial.summary = `${summary}\n\n待批准发信未就绪：请在交办任务中填写真实客户邮箱（禁止 example.com 占位地址）。`;
      }
    }
    pushInbox(workspaceDir, automation, inboxPartial);
  } else {
    // custom without template — inbox only
    summary = automation.instruction?.trim() || "自定义交办已到期，请在对话中继续处理。";
    pushInbox(workspaceDir, automation, {
      title: `${automation.title} · 待处理`,
      summary,
    });
  }

  const next: LawyerAutomation = {
    ...automation,
    lastRunAt: now.toISOString(),
    lastJobId: jobId,
    lastResultSummary: summary.slice(0, 500),
    nextRunAt:
      automation.schedule.kind === "once"
        ? automation.schedule.runAt
        : computeNextRunAt(automation.schedule, new Date(now.getTime() + 60_000)),
    updatedAt: now.toISOString(),
    enabled: automation.schedule.kind === "once" ? false : automation.enabled,
  };
  saveAutomation(workspaceDir, next);
}

/** Process enabled automations whose nextRunAt <= now. Returns count fired. */
export async function processDueLawyerAutomations(
  workspaceDir: string,
  hooks: AutomationRunHooks = {},
  now: Date = new Date(),
): Promise<number> {
  const due = listAutomations(workspaceDir).filter(
    (a) => a.enabled && Date.parse(a.nextRunAt) <= now.getTime(),
  );
  let n = 0;
  for (const automation of due) {
    try {
      await runOneAutomation(workspaceDir, automation, hooks, now);
      n += 1;
    } catch {
      const failed = getAutomation(workspaceDir, automation.id);
      if (failed) {
        saveAutomation(workspaceDir, {
          ...failed,
          lastResultSummary: "运行失败（详见本地日志）",
          nextRunAt: computeNextRunAt(failed.schedule, new Date(now.getTime() + 3_600_000)),
          updatedAt: now.toISOString(),
        });
      }
    }
  }
  return n;
}

export { createAutomation };
