/**
 * Pure free-text → automation preset mapping (no fs / Node).
 * Safe for desktop renderer and agent/platform code.
 */

export type AutomationPresetId =
  | "renewal-monitor"
  | "client-weekly-update"
  | "mail-inbox-digest"
  | "mail-contract-review"
  | "custom";

export type AutomationMissingDataPolicy = "report_failure" | "report_partial" | "skip_run";
export type AutomationNotifyPolicy = "always" | "on_problem" | "never";

export type AutomationConfirmationDraft = {
  expectedResult: string;
  approvalBoundary: string;
  missingDataPolicy: AutomationMissingDataPolicy;
  notifyPolicy: AutomationNotifyPolicy;
};

/**
 * 每个模板自带一份可改的规矩。
 *
 * Cursor / Codex 从一句话起草自动化，Harvey 在开跑前给出可改的计划。
 * 律师选模板就能开跑；要改标准再改这四句，而不是面对空白表单。
 * 外发和改已签原稿仍然停在批准，不因预填而放行。
 */
export function draftAutomationConfirmations(presetId: string): AutomationConfirmationDraft {
  switch (presetId) {
    case "renewal-monitor":
      return {
        expectedResult: "列出即将到期或需要续签的合同，写明合同名、到期日，以及要不要续。",
        approvalBoundary: "不要自行发续签函，也不要改合同；只把清单交给我看。",
        missingDataPolicy: "report_partial",
        notifyPolicy: "on_problem",
      };
    case "client-weekly-update":
      return {
        expectedResult: "一份给客户的进展备忘，只写本案已经发生的事实，不编造进度。",
        approvalBoundary: "发给客户之前必须等我批准；不要改已经签署的原稿。",
        missingDataPolicy: "report_partial",
        notifyPolicy: "always",
      };
    case "mail-inbox-digest":
      return {
        expectedResult: "只整理新来信的要点，以及哪几封要回；没有新来信就不要重复上次。",
        approvalBoundary: "不要代我回信，也不要外发。",
        missingDataPolicy: "report_partial",
        notifyPolicy: "on_problem",
      };
    case "mail-contract-review":
      return {
        expectedResult: "对新来的合同附件做最小改稿或意见。同一份已经被停下的附件不要反复重派。",
        approvalBoundary: "不要发信，不要用新文件替换原件；外发必须等我批准。",
        missingDataPolicy: "report_partial",
        notifyPolicy: "on_problem",
      };
    default:
      return {
        expectedResult: "按你写的那句话办完，并写明做到哪一步。",
        approvalBoundary: "外发、以及改已经签署的原稿，之前必须先问我。",
        missingDataPolicy: "report_partial",
        notifyPolicy: "on_problem",
      };
  }
}

/** Map free-text lawyer instruction to a preset + cleaned title. */
export function inferAutomationFromInstruction(text: string): {
  presetId: AutomationPresetId;
  title: string;
  instruction: string;
  allowSendEmailAfterApproval: boolean;
} {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  if (/邮件|邮箱|inbox|gmail|outlook/.test(raw) && /合同|审阅|审查|附件|改稿/.test(raw)) {
    return {
      presetId: "mail-contract-review",
      title: "邮件合同审阅改稿",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/邮件|邮箱|收件|来信|待回复/.test(raw)) {
    return {
      presetId: "mail-inbox-digest",
      title: "邮箱收件整理",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/续签|续展|到期|终止通知/.test(raw)) {
    return {
      presetId: "renewal-monitor",
      title: "合同续签盯梢",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/客户|周报|进展备忘|update/.test(lower) || /发给客户|回客户/.test(raw)) {
    return {
      presetId: "client-weekly-update",
      title: "客户进展周报",
      instruction: raw,
      allowSendEmailAfterApproval: /发信|发送|邮件给客户/.test(raw),
    };
  }
  return {
    presetId: "custom",
    title: raw.slice(0, 40) || "自定义交办",
    instruction: raw,
    allowSendEmailAfterApproval: false,
  };
}
