/**
 * Per-account outbound mail format (From display name, closing, 落款).
 * Applied when preparing / sending; idempotent if the body already has the block.
 */

export const MAIL_CLOSING_STYLES = ["none", "formal", "business", "reply", "custom"] as const;
export type MailClosingStyle = (typeof MAIL_CLOSING_STYLES)[number];

export const MAIL_CLOSING_STYLE_OPTIONS: ReadonlyArray<{
  id: MailClosingStyle;
  label: string;
  text: string;
}> = [
  { id: "none", label: "不自动加结束语", text: "" },
  { id: "formal", label: "此致敬礼（函件）", text: "此致\n敬礼" },
  { id: "business", label: "顺颂商祺（商务）", text: "顺颂商祺" },
  { id: "reply", label: "此复", text: "此复" },
  { id: "custom", label: "自定义结束语", text: "" },
];

export type MailSendFormat = {
  /** 发件显示名，用于 From: 「张三律师」<email> */
  fromName?: string;
  closingStyle?: MailClosingStyle;
  customClosing?: string;
  /** 落款正文（所名、律师名、电话等） */
  signature?: string;
  /** 正文未含落款时自动附加。缺省为 true。 */
  appendIfMissing?: boolean;
};

export const MAIL_FROM_NAME_MAX = 80;
export const MAIL_CUSTOM_CLOSING_MAX = 200;
export const MAIL_SIGNATURE_MAX = 2000;

function isClosingStyle(value: unknown): value is MailClosingStyle {
  return typeof value === "string" && (MAIL_CLOSING_STYLES as readonly string[]).includes(value);
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

export function alreadyHasMailBlock(body: string, block: string): boolean {
  const needle = compact(block);
  if (!needle) {
    return true;
  }
  return compact(body).includes(needle);
}

export function resolveMailClosingText(format: MailSendFormat | undefined): string {
  if (!format) {
    return "";
  }
  const style = format.closingStyle ?? "none";
  if (style === "custom") {
    return (format.customClosing ?? "").trim();
  }
  return MAIL_CLOSING_STYLE_OPTIONS.find((row) => row.id === style)?.text ?? "";
}

export function sanitizeMailSendFormat(raw: unknown): MailSendFormat | undefined {
  if (raw == null || typeof raw !== "object") {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const fromName =
    typeof o.fromName === "string" ? o.fromName.trim().slice(0, MAIL_FROM_NAME_MAX) : "";
  const closingStyle = isClosingStyle(o.closingStyle) ? o.closingStyle : "none";
  const customClosing =
    typeof o.customClosing === "string"
      ? o.customClosing.replace(/\r\n/g, "\n").trim().slice(0, MAIL_CUSTOM_CLOSING_MAX)
      : "";
  const signature =
    typeof o.signature === "string"
      ? o.signature.replace(/\r\n/g, "\n").trim().slice(0, MAIL_SIGNATURE_MAX)
      : "";
  const appendIfMissing = o.appendIfMissing !== false;
  const out: MailSendFormat = {};
  if (fromName) {
    out.fromName = fromName;
  }
  if (closingStyle !== "none") {
    out.closingStyle = closingStyle;
  }
  if (closingStyle === "custom" && customClosing) {
    out.customClosing = customClosing;
  }
  if (signature) {
    out.signature = signature;
  }
  if (!appendIfMissing) {
    out.appendIfMissing = false;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function hasMailSendFormat(format: MailSendFormat | undefined): boolean {
  return Boolean(sanitizeMailSendFormat(format));
}

export function applyMailSendFormat(body: string, format: MailSendFormat | undefined): string {
  const text = typeof body === "string" ? body : "";
  if (!format || format.appendIfMissing === false) {
    return text;
  }
  const closing = resolveMailClosingText(format);
  const signature = format.signature?.trim() ?? "";
  const parts: string[] = [];
  if (closing && !alreadyHasMailBlock(text, closing)) {
    parts.push(closing);
  }
  if (signature && !alreadyHasMailBlock(text, signature)) {
    parts.push(signature);
  }
  if (parts.length === 0) {
    return text;
  }
  const trimmed = text.replace(/\s+$/, "");
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : "";
  return `${prefix}${parts.join("\n\n")}`;
}

export function formatMailFromAddress(
  email: string,
  format?: MailSendFormat,
): { name?: string; address: string } {
  const name = format?.fromName?.trim();
  return name ? { name, address: email } : { address: email };
}

export function previewMailSendFormat(format: MailSendFormat | undefined): string {
  return applyMailSendFormat("您好：\n\n（邮件正文）", {
    ...format,
    appendIfMissing: true,
  });
}

export function buildMailSendFormatPrompt(format: MailSendFormat | undefined): string | undefined {
  const sanitized = sanitizeMailSendFormat(format);
  if (!sanitized) {
    return undefined;
  }
  const closing = resolveMailClosingText(sanitized);
  const signature = sanitized.signature?.trim() ?? "";
  const fromName = sanitized.fromName?.trim() ?? "";
  if (!closing && !signature && !fromName) {
    return undefined;
  }
  const lines = [
    "## 外发邮件落款",
    "",
    "本案发信账号已配置发送格式。撰写 `prepare_outbound_mail` / `send_email` 正文时请使用以下落款，不要另编所名或律师名。系统会在正文未含落款时自动附加。",
    "",
  ];
  if (fromName) {
    lines.push(`发件显示名：${fromName}`, "");
  }
  if (closing) {
    lines.push("结束语：", closing, "");
  }
  if (signature) {
    lines.push("落款：", signature, "");
  }
  if (sanitized.appendIfMissing === false) {
    lines.push("（已关闭自动附加：只有正文里写了才会出现。）");
  }
  return lines.join("\n").trim();
}
