/**
 * Due-automation tick: enqueue workflows, digest mail, push results to automation inbox.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveLawMindRoot } from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { resolveMailAccountForMatter } from "../mail/mail-accounts.js";
import { applyMailSendFormat } from "../mail/mail-send-format.js";
import { syncMatterMailbox } from "../mail/sync-inbox.js";
import {
  dispatchFingerprint,
  findBlockedDispatch,
  formatBlockedDispatchNote,
  upsertDispatchEntry,
} from "./automation-dispatch-ledger.js";
import { consumeWebhookEvent, eventTriggerIsDue } from "./automation-event-scan.js";
import {
  appendAutomationRun,
  type AutomationRunRecord,
  type AutomationRunStatus,
} from "./automation-run-history.js";
import { detectDossierSourceGap } from "./automation-source-gap.js";
import {
  buildMailContractReviewSummary,
  buildMailDigestSummary,
  computeNextRunAt,
  claimDueAutomation,
  claimEventAutomation,
  createAutomation,
  extractNotifyEmail,
  getAutomation,
  listAutomations,
  listMatterMailMessages,
  materializeMailContractReviewBaselines,
  sanitizeNotifyEmail,
  saveAutomation,
  saveAutomationInboxItem,
  shouldNotifyLawyer,
  automationNotifyPolicy,
  automationMissingDataPolicy,
  buildAutomationJobBriefNote,
  buildAutomationRunContinuityNote,
  mailDigestQuietKey,
  dispositionForMissingData,
  type LawyerAutomation,
  type AutomationInboxItem,
} from "./lawyer-automations.js";

/**
 * 一次运行的结论。`status` 与运行历史里的 `AutomationRunStatus` 对齐
 * （`failed` 由抛出/捕获路径产生，这里只报「正常走完」的三种）。
 */
export type AutomationRunOutcome = {
  inboxPushed: number;
  status: "ok" | "blocked" | "skipped";
  missingData?: string[];
};

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
): Promise<AutomationRunOutcome> {
  let summary = "";
  let jobId: string | undefined;
  let mailMessageIds: string[] | undefined;
  let pendingSend: AutomationInboxItem["pendingSend"] | undefined;
  /** 本次运行真的往收件箱推了几条——`notified` 记的是事实，不是策略意图。 */
  let inboxPushed = 0;
  /**
   * 运行结论。此前用「推了收件箱就算 blocked」推断，那是错的：
   * 推一条「运行结果」是信息通报，推「待批准发信」才是要律师拍板。
   * 现在各上报点显式声明自己的性质，不再靠条数猜。
   */
  let status: AutomationRunOutcome["status"] = "ok";
  /** 因前提缺失而未产出时，缺的是什么（进运行记录，供缺资料策略与 P4 统计）。 */
  const missingData: string[] = [];
  /** 本轮结束后记住的「没有新东西」标记；有新工作时清掉。 */
  let nextQuietKey: string | undefined = automation.lastQuietKey;
  const push = (
    args: Parameters<typeof pushInbox>[2],
    kind: "informational" | "needs_lawyer" = "informational",
  ) => {
    inboxPushed += 1;
    if (kind === "needs_lawyer") {
      status = "blocked";
    }
    return pushInbox(workspaceDir, automation, args);
  };
  function buildOutcome(): AutomationRunOutcome {
    return {
      inboxPushed,
      status,
      missingData: missingData.length > 0 ? missingData : undefined,
    };
  }

  if (
    automation.presetId === "mail-inbox-digest" ||
    automation.presetId === "mail-contract-review"
  ) {
    const lawMindRoot =
      hooks.lawMindRoot?.trim() || resolveLawMindRoot(workspaceDir, hooks.envFile);
    let syncNote = "";
    /** 本次是否遇到「源数据不可用」——缺资料策略据此决定要不要继续。 */
    let mailUnavailable: string | undefined;
    try {
      const sync = await syncMatterMailbox(workspaceDir, lawMindRoot, automation.matterId, {
        limit: 30,
        // 拉完整正文（Graph 默认仅 bodyPreview），对齐 IMAP 全文语义供合同审阅/摘要。
        includeBody: true,
      });
      if ("skipped" in sync && sync.skipped) {
        mailUnavailable = "未配置远程邮箱";
        syncNote = "（未配置远程邮箱：请到「设置 → 自动办件」接上邮箱后再同步。）\n\n";
      } else if (sync.ok && "written" in sync) {
        const mode =
          sync.watchMode === "contacts" ? `（按对方名单过滤，跳过 ${sync.filteredOut} 封）` : "";
        syncNote = `（已从远程邮箱同步 ${sync.written} 封${mode}）\n\n`;
      } else if (!sync.ok) {
        mailUnavailable = `远程同步失败（${sync.hint || sync.error || "原因未知"}）`;
        syncNote = `（远程同步失败：${sync.hint || sync.error}；仍读取本地匣。）\n\n`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mailUnavailable = `远程同步异常（${msg.slice(0, 120)}）`;
      syncNote = `（远程同步异常：${msg.slice(0, 120)}；仍读取本地匣。）\n\n`;
    }

    // ── 缺资料策略（六确认之一）在这里生效 ──
    // 此前这个字段只存不读：律师在表单里选了处置方式，运行期一次都没消费。
    // 语义贴着**既有行为**定：默认 `report_partial` = 退回读本地匣并如实披露（现状），
    // `report_failure` = 停下来并如实报失败，`skip_run` = 停下来且不打扰。
    const disposition = dispositionForMissingData(automationMissingDataPolicy(automation));
    if (mailUnavailable && disposition !== "proceed") {
      missingData.push(mailUnavailable);
      summary = `${automation.title}：${mailUnavailable}，按你设定的规矩没有继续办。`;
      if (disposition === "fail_run") {
        push({ title: `${automation.title} · 没能办成`, summary });
      }
      status = "skipped";
      const skipped: LawyerAutomation = {
        ...automation,
        lastRunAt: now.toISOString(),
        lastJobId: undefined,
        lastResultSummary: summary.slice(0, 500),
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        nextRunAt:
          automation.schedule.kind === "once"
            ? automation.schedule.runAt
            : computeNextRunAt(automation.schedule, new Date(now.getTime() + 60_000)),
        updatedAt: now.toISOString(),
        enabled: automation.schedule.kind === "once" ? false : automation.enabled,
      };
      saveAutomation(workspaceDir, skipped);
      return buildOutcome();
    }
    if (mailUnavailable) {
      // 继续办，但把缺口带进运行记录（运行历史里能看出「这次是降级跑的」）。
      missingData.push(mailUnavailable);
    }
    const messages = listMatterMailMessages(workspaceDir, automation.matterId);
    mailMessageIds = messages.map((m) => m.id);

    if (automation.presetId === "mail-inbox-digest") {
      const quietKey = mailDigestQuietKey(mailMessageIds);
      const unchanged = automation.lastQuietKey === quietKey;
      // 「每次都通知」是律师显式选择，不能被静音盖掉。没写过策略的旧办件默认 always。
      const honorAlways = automationNotifyPolicy(automation) === "always";
      if (unchanged && !honorAlways) {
        summary =
          mailMessageIds.length === 0
            ? `${syncNote}没有新来信，这次不重复整理。`
            : `${syncNote}来信和上次一样，这次不重复整理。`;
        status = "skipped";
      } else {
        summary = syncNote + buildMailDigestSummary(messages);
        nextQuietKey = quietKey;
        push({
          title: `${automation.title} · 运行结果`,
          summary,
          mailMessageIds,
        });
      }
    } else {
      const drafted = buildMailContractReviewSummary(messages, automation.matterId);
      const built = await materializeMailContractReviewBaselines(
        workspaceDir,
        messages,
        automation.matterId,
        drafted,
      );
      summary = syncNote + built.summary;
      if (automation.instruction?.trim()) {
        summary = `${summary}\n\n交办补充：${automation.instruction.trim()}`;
      }
      const templateId = automation.templateId || "mail-contract-redline";
      const canEnqueue =
        Boolean(
          built.preferredBaselinePath ||
          built.preferredSourcePath ||
          built.attachmentRefs.length > 0,
        ) && Boolean(hooks.enqueueTemplate);
      const baselinePath = (built.preferredBaselinePath ?? built.preferredSourcePath ?? "").trim();
      // 防重复派单：同一份材料上次已被门禁停下 → 不再重派（Codex 对齐「不重跑注定失败的事」）。
      const blocked = baselinePath
        ? findBlockedDispatch(workspaceDir, {
            matterId: automation.matterId,
            relativePath: baselinePath,
            fingerprint: dispatchFingerprint(workspaceDir, baselinePath),
          })
        : undefined;
      const continuity = buildAutomationRunContinuityNote(automation);
      const blockedQuietKey = blocked ? `blocked:${blocked.fingerprint}` : undefined;
      if (blocked && automation.lastQuietKey === blockedQuietKey) {
        summary = `${summary}\n\n同一份材料上次已经停下，这次不再重复提醒。`;
        status = "skipped";
      } else if (blocked) {
        summary = `${summary}\n\n${formatBlockedDispatchNote(blocked)}`;
        nextQuietKey = blockedQuietKey;
      } else if (canEnqueue && hooks.enqueueTemplate) {
        const instruction = [
          built.workflowInstruction,
          automation.instruction?.trim() ? `\n交办补充：${automation.instruction.trim()}` : "",
          // 六确认里的期望结果与审批边界必须进模型可见文本，否则律师填了等于没填。
          buildAutomationJobBriefNote(automation)
            ? `\n${buildAutomationJobBriefNote(automation)}`
            : "",
          continuity,
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
        const modeHint =
          built.reviewMode === "tracked" ? "审阅改稿（含 Word 痕迹）" : "意见书级审查";
        summary = jobId
          ? `${summary}\n\n已启动邮件合同${modeHint}工作流「${templateId}」（任务 ${jobId.slice(0, 8)}…）。完成后请在「文书台」签批；外发须在待拍板「批准发送」。`
          : `${summary}\n\n未能启动工作流「${templateId}」。请确认协作模板存在且案件有效；仍可按附件路径在对话中交办审查。`;
      } else if (built.attachmentRefs.length === 0) {
        summary = `${summary}\n\n未启动审阅工作流（无可用 Word/PDF/图片等合同附件）。`;
      } else {
        summary = `${summary}\n\n（本地未挂载工作流入队钩子，仅生成附件路径清单。）`;
      }
      const repeatBlocked = Boolean(blocked) && automation.lastQuietKey === blockedQuietKey;
      if (repeatBlocked) {
        // 同一份材料已经告诉过律师，不再每隔一个周期推一条「未重复派单」。
      } else if (!blocked) {
        nextQuietKey = undefined;
        // 有待批准发信时才需要律师拍板（下面 push 的 kind 决定）；否则只是通报。
        push({
          title: `${automation.title} · 运行结果`,
          summary,
          mailMessageIds,
          jobId,
        });
      } else {
        // 「未重复派单」需要律师知情并自行处理材料，属需要拍板的一类。只说一次。
        push(
          {
            title: `${automation.title} · 未重复派单`,
            summary,
            mailMessageIds,
          },
          "needs_lawyer",
        );
      }
      // 派单记账：门禁之后若把本件停下，同一指纹就不再重派。
      if (jobId && baselinePath) {
        upsertDispatchEntry(workspaceDir, {
          matterId: automation.matterId,
          relativePath: baselinePath,
          fingerprint: dispatchFingerprint(workspaceDir, baselinePath),
          state: "dispatched",
          automationId: automation.id,
          at: now.toISOString(),
        });
      }
    }
  } else if (
    automation.presetId === "renewal-monitor" ||
    automation.presetId === "client-weekly-update" ||
    (automation.presetId === "custom" && automation.templateId)
  ) {
    const sourceGap = detectDossierSourceGap(
      workspaceDir,
      automation.presetId,
      automation.matterId,
    );
    if (sourceGap) {
      missingData.push(sourceGap);
      const disposition = dispositionForMissingData(automationMissingDataPolicy(automation));
      if (disposition !== "proceed") {
        summary = `${automation.title}：${sourceGap}，按你设定的规矩没有继续办。`;
        if (disposition === "fail_run") {
          push({ title: `${automation.title} · 没能办成`, summary });
        }
        status = "skipped";
        const skipped: LawyerAutomation = {
          ...automation,
          lastRunAt: now.toISOString(),
          lastJobId: undefined,
          lastResultSummary: summary.slice(0, 500),
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          nextRunAt:
            automation.schedule.kind === "once"
              ? automation.schedule.runAt
              : computeNextRunAt(automation.schedule, new Date(now.getTime() + 60_000)),
          updatedAt: now.toISOString(),
          enabled: automation.schedule.kind === "once" ? false : automation.enabled,
        };
        saveAutomation(workspaceDir, skipped);
        return buildOutcome();
      }
    }
    const templateId =
      automation.templateId ||
      (automation.presetId === "renewal-monitor"
        ? "renewal-monitor"
        : automation.presetId === "client-weekly-update"
          ? "client-update-memo"
          : undefined);
    if (templateId && hooks.enqueueTemplate) {
      const briefNote = buildAutomationJobBriefNote(automation);
      const continuityNote = buildAutomationRunContinuityNote(automation);
      nextQuietKey = undefined;
      const enqueued = await hooks.enqueueTemplate({
        templateId,
        matterId: automation.matterId,
        // 期望结果、审批边界和上次办到哪，必须随交办一起给到。
        instruction:
          [automation.instruction?.trim(), briefNote, continuityNote]
            .filter(Boolean)
            .join("\n\n") || undefined,
        automationId: automation.id,
      });
      jobId = enqueued ?? undefined;
      summary = jobId
        ? `已启动后台工作流「${templateId}」（任务 ${jobId.slice(0, 8)}…）。完成后请在「在办」或「待我拍板」查看。`
        : `未能启动工作流「${templateId}」。请确认协作模板存在且案件有效。`;
    } else {
      summary = automation.instruction?.trim()
        ? `自定义交办已记录：${automation.instruction.trim()}。请到对话中继续处理，或绑定可预约工作流模板。`
        : "自动办件已触发，但未配置可执行模板。";
    }
    const inboxPartial: Parameters<typeof pushInbox>[2] = {
      title: `${automation.title} · 运行结果`,
      summary,
      jobId,
    };
    if (automation.allowSendEmailAfterApproval && automation.presetId === "client-weekly-update") {
      const to = resolveNotifyEmail(automation);
      if (to) {
        const account = resolveMailAccountForMatter(workspaceDir, automation.matterId);
        pendingSend = {
          to,
          subject: `【${automation.matterId}】本案进展说明`,
          body: applyMailSendFormat(
            `${summary}\n\n（批准后将写入本案 mail/sent，并尝试通过已配置的邮箱账号发送。）`,
            account?.sendFormat,
          ),
        };
        inboxPartial.pendingSend = pendingSend;
      } else {
        inboxPartial.summary = `${summary}\n\n待批准发信未就绪：请在自动办件中填写真实客户邮箱（禁止 example.com 占位地址）。`;
      }
    }
    // 待批准发信 = 律师欠一个决定；没有待发信则只是通报。
    push(inboxPartial, pendingSend ? "needs_lawyer" : "informational");
  } else {
    // custom without template — inbox only
    summary = automation.instruction?.trim() || "自定义交办已到期，请在对话中继续处理。";
    push(
      {
        title: `${automation.title} · 待处理`,
        summary,
      },
      "needs_lawyer",
    );
  }

  const next: LawyerAutomation = {
    ...automation,
    lastRunAt: now.toISOString(),
    lastJobId: jobId,
    lastResultSummary: summary.slice(0, 500),
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    lastQuietKey: nextQuietKey,
    nextRunAt:
      automation.schedule.kind === "once"
        ? automation.schedule.runAt
        : computeNextRunAt(automation.schedule, new Date(now.getTime() + 60_000)),
    updatedAt: now.toISOString(),
    enabled: automation.schedule.kind === "once" ? false : automation.enabled,
  };
  saveAutomation(workspaceDir, next);
  return buildOutcome();
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
  for (const listed of due) {
    const automation = claimDueAutomation(workspaceDir, listed.id, now);
    if (!automation) {
      continue;
    }
    const startedAt = new Date().toISOString();
    try {
      const outcome = await runOneAutomation(workspaceDir, automation, hooks, now);
      n += 1;
      const saved = getAutomation(workspaceDir, automation.id);
      recordScheduledRun(workspaceDir, automation, {
        // 结论由 runOneAutomation 显式给出，不再按「推了几条」推断
        // （推一条「运行结果」是通报，推「待批准发信」才是要律师拍板）。
        status: outcome.status,
        startedAt,
        summary: saved?.lastResultSummary,
        jobId: saved?.lastJobId,
        // 缺资料导致的降级/跳过进运行记录，供 P4 统计与准入量表。
        missingData: outcome.missingData,
        notified: outcome.inboxPushed > 0,
      });
    } catch (err) {
      const failed = getAutomation(workspaceDir, automation.id);
      const message = err instanceof Error ? err.message : String(err);
      const code = classifyAutomationRunError(err);
      if (failed) {
        saveAutomation(workspaceDir, {
          ...failed,
          lastResultSummary: `运行失败（${code}）：${message.slice(0, 200)}`,
          lastErrorCode: code,
          lastErrorMessage: message.slice(0, 500),
          nextRunAt: computeNextRunAt(failed.schedule, new Date(now.getTime() + 3_600_000)),
          updatedAt: now.toISOString(),
        });
      }
      // 结构化错误码 + 审计事件：排障不再只有「运行失败」四个字。
      try {
        await emit(path.join(workspaceDir, "audit"), {
          taskId: automation.id,
          kind: "automation.run_failed",
          actor: "system",
          detail: JSON.stringify({
            automationId: automation.id,
            presetId: automation.presetId,
            code,
            message: message.slice(0, 500),
          }),
        });
      } catch {
        /* 审计失败不再抛 */
      }
      const notified = shouldNotifyLawyer(automationNotifyPolicy(automation), "failed");
      if (notified) {
        try {
          pushInbox(workspaceDir, automation, {
            title: "自动办件失败",
            summary: `${code}：${message.slice(0, 200)}`,
          });
        } catch {
          /* inbox 失败不再抛 */
        }
      }
      recordScheduledRun(workspaceDir, automation, {
        status: "failed",
        startedAt,
        errorCode: code,
        errorMessage: message.slice(0, 500),
        notified,
      });
    }
  }
  const scheduledIds = new Set(due.map((item) => item.id));
  for (const listed of listAutomations(workspaceDir)) {
    if (scheduledIds.has(listed.id) || !eventTriggerIsDue(workspaceDir, listed, now)) {
      continue;
    }
    const automation = claimEventAutomation(workspaceDir, listed.id, now);
    if (!automation) {
      continue;
    }
    if (automation.eventTrigger?.source === "webhook") {
      consumeWebhookEvent(workspaceDir, automation.id);
    }
    const startedAt = new Date().toISOString();
    try {
      const outcome = await runOneAutomation(workspaceDir, automation, hooks, now);
      n += 1;
      const saved = getAutomation(workspaceDir, automation.id);
      recordScheduledRun(
        workspaceDir,
        automation,
        {
          status: outcome.status,
          startedAt,
          summary: saved?.lastResultSummary,
          jobId: saved?.lastJobId,
          missingData: outcome.missingData,
          notified: outcome.inboxPushed > 0,
        },
        "event",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordScheduledRun(
        workspaceDir,
        automation,
        {
          status: "failed",
          startedAt,
          errorCode: classifyAutomationRunError(err),
          errorMessage: message.slice(0, 500),
          notified: false,
        },
        "event",
      );
    }
  }
  return n;
}

/**
 * 落一条「计划触发」的运行记录。
 *
 * 记录的是**发生的事实**（收件箱里真有没有多一条），不是策略意图——
 * 否则历史会变成一份「看起来该静默」的账，而静默成功恰恰不能靠猜。
 */
function recordScheduledRun(
  workspaceDir: string,
  automation: LawyerAutomation,
  input: {
    status: AutomationRunStatus;
    startedAt: string;
    summary?: string;
    jobId?: string;
    errorCode?: string;
    errorMessage?: string;
    missingData?: string[];
    notified: boolean;
  },
  trigger: AutomationRunRecord["trigger"] = "schedule",
): void {
  const record: AutomationRunRecord = {
    runId: randomUUID(),
    automationId: automation.id,
    trigger,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: new Date().toISOString(),
    summary: input.summary?.slice(0, 500),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    jobId: input.jobId,
    missingData: input.missingData,
    notified: input.notified,
  };
  appendAutomationRun(workspaceDir, record);
}

/** 运行失败的粗分类（结构化 code，供 UI/审计筛选）。 */
export function classifyAutomationRunError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/missing_api_key|missing_provider_api_key|missing_platform_api_key/i.test(msg)) {
    return "missing_api_key";
  }
  if (/sync_failed|imap|graph_/i.test(msg)) {
    return "mail_sync_failed";
  }
  if (/workflow|template/i.test(msg)) {
    return "workflow_enqueue_failed";
  }
  if (/model_network_error|ECONN|ETIMEDOUT|fetch failed/i.test(msg)) {
    return "model_network_error";
  }
  return "automation_run_failed";
}

export { createAutomation };
