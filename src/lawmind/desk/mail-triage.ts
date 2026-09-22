/**
 * Inbox classification for the daily work loop.
 * Default rules are open; lawyers can add extra keywords via UserStandard.bindWhen.
 */

export const MAIL_TRIAGE_LABELS = ["needs_reply", "fyi", "contract", "court"] as const;

export type MailTriageLabel = (typeof MAIL_TRIAGE_LABELS)[number];

export type MailTriageInput = {
  from: string;
  subject: string;
  bodyText?: string;
  attachmentNames?: string[];
};

export type MailTriageRuleHint = {
  extraReplyKeywords?: string[];
  extraCourtKeywords?: string[];
  extraContractKeywords?: string[];
  watchSenders?: string[];
};

const SKIP_RE =
  /noreply|no-reply|自动回复|邮件投递失败|unsubscribe|notifications@github|github\.com/i;
const COURT_RE = /法院|传票|12368|开庭|举证通知|立案通知/;
const CONTRACT_RE = /合同|协议|nda|保密协议|\.docx|修订稿/i;
const REPLY_RE = /请尽快|烦请|请回复|请确认|是否同意|能否/;

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, " ");
}

export function classifyMailMessage(
  input: MailTriageInput,
  rules?: MailTriageRuleHint,
): MailTriageLabel {
  const from = input.from ?? "";
  const subject = input.subject ?? "";
  const body = input.bodyText ?? "";
  const blob = `${from}\n${subject}\n${body}\n${(input.attachmentNames ?? []).join(" ")}`;
  if (SKIP_RE.test(from) || SKIP_RE.test(blob)) {
    return "fyi";
  }
  const watch = (rules?.watchSenders ?? []).some((s) =>
    from.toLowerCase().includes(s.trim().toLowerCase()),
  );
  const courtExtra = (rules?.extraCourtKeywords ?? []).some((k) => k && blob.includes(k));
  if (COURT_RE.test(blob) || courtExtra) {
    return "court";
  }
  const contractExtra = (rules?.extraContractKeywords ?? []).some((k) => k && blob.includes(k));
  if (CONTRACT_RE.test(blob) || contractExtra) {
    return "contract";
  }
  const replyText = stripUrls(`${subject}\n${body}`);
  const replyExtra = (rules?.extraReplyKeywords ?? []).some((k) => k && replyText.includes(k));
  if (REPLY_RE.test(replyText) || /[？?]\s*$/.test(subject.trim()) || replyExtra || watch) {
    return "needs_reply";
  }
  return "fyi";
}

export const MAIL_TRIAGE_LABEL_ZH: Record<MailTriageLabel, string> = {
  needs_reply: "待回复",
  fyi: "仅知会",
  contract: "附件待审",
  court: "法院材料",
};
