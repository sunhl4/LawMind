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
  if (/邮件|邮箱|收件|来信/.test(raw)) {
    return {
      presetId: "mail-inbox-digest",
      title: "邮箱收件整理",
      instruction: raw,
      allowSendEmailAfterApproval: false,
    };
  }
  if (/续签|到期|终止通知/.test(raw)) {
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
