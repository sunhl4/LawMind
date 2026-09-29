/**
 * 对话里给律师点的两种链接。
 *
 * - `[文书标题](lm-draft:<taskId>)` 打开这份稿
 * - `[《法律名称》第N条](https://…)` 打开检索到的法条原文
 *
 * 不另写一份法条文稿，也不做画布：画布读不到权威库，第二份稿会和意见脱节。
 * 点不开的地址（非 https、本机、私网，或看不出是法条）只留标题，不变成按钮。
 */

export type LawyerChatLink =
  | { kind: "draft"; label: string; taskId: string }
  | { kind: "statute"; label: string; url: string }
  | { kind: "plain"; label: string };

const LABEL_MAX = 200;
const TASK_ID_RE = /^[A-Za-z0-9._-]{1,80}$/;

export function isDraftTaskId(value: string): boolean {
  const id = value.trim();
  return TASK_ID_RE.test(id) && !id.includes("..");
}

function isPrivateOrLocalHost(host: string): boolean {
  const h = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) {
    return true;
  }
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!v4) {
    return false;
  }
  const parts = [v4[1], v4[2], v4[3], v4[4]].map((p) => Number(p));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

function labelLooksLikeCite(label: string): boolean {
  return (
    /《[^》]{1,80}》/.test(label) || /第[0-9０-９零一二三四五六七八九十百千]{1,12}条/.test(label)
  );
}

function hostLooksLegal(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return (
    h === "gov.cn" ||
    h.endsWith(".gov.cn") ||
    h === "pkulaw.com" ||
    h.endsWith(".pkulaw.com") ||
    h === "chinalawinfo.com" ||
    h.endsWith(".chinalawinfo.com")
  );
}

/** https 原文，且要么标题像法条，要么主机是法规站点。否则返回 null。 */
export function statuteJumpUrl(href: string, label: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return null;
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    return null;
  }
  if (!labelLooksLikeCite(label) && !hostLooksLegal(url.hostname)) {
    return null;
  }
  return url.toString();
}

export function tryConsumeLawyerChatLink(
  text: string,
  start: number,
): { link: LawyerChatLink; next: number } | null {
  if (text[start] !== "[") {
    return null;
  }
  const close = text.indexOf("](", start + 1);
  if (close < 0 || close === start + 1) {
    return null;
  }
  const label = text.slice(start + 1, close).trim();
  if (!label || label.includes("\n") || label.length > LABEL_MAX) {
    return null;
  }
  const hrefStart = close + 2;
  const hrefEnd = text.indexOf(")", hrefStart);
  if (hrefEnd < 0) {
    return null;
  }
  const href = text.slice(hrefStart, hrefEnd).trim();
  if (!href || /\s/.test(href)) {
    return null;
  }
  const next = hrefEnd + 1;

  if (/^lm-draft:/i.test(href)) {
    const taskId = href.slice("lm-draft:".length);
    if (!isDraftTaskId(taskId)) {
      return null;
    }
    return { link: { kind: "draft", label, taskId }, next };
  }

  if (/^https:\/\//i.test(href)) {
    const url = statuteJumpUrl(href, label);
    if (!url) {
      return { link: { kind: "plain", label }, next };
    }
    return { link: { kind: "statute", label, url }, next };
  }

  return null;
}
