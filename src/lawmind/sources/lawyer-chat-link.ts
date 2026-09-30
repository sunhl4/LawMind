/**
 * 对话里给律师点的链接。
 *
 * - `[文书标题](lm-draft:<taskId>)` 打开这份稿
 * - `[短标题](https://…)` 或句子里的公网地址，用系统浏览器打开
 * - `[短标题](相对路径)` 或句子里的工作区文件，在编辑区打开；`.canvas.tsx` 就是画布
 * - Word / Excel / PPT / PDF（及 `.wps` 等）相对路径，用本机 WPS 打开，不进修订面
 * - `[文件地址](lm-wps:编码后的相对路径)` 同样用 WPS 打开
 *
 * 内网、带账号密码的地址、磁盘绝对路径和 `..` 只留文字，不变成按钮。
 */

export type LawyerChatLink =
  | { kind: "draft"; label: string; taskId: string }
  | { kind: "web"; label: string; url: string }
  | { kind: "file"; label: string; path: string; canvas: boolean; line?: number; column?: number }
  | { kind: "wps"; label: string; path: string }
  | { kind: "plain"; label: string };

/** WPS 能直接打开的交付件。 */
const WPS_FILE_EXT = /\.(?:doc|docx|wps|xls|xlsx|et|ppt|pptx|dps|pdf)$/i;

/** 对话里自动变成按钮的文件后缀。画布是其中的 `.canvas.tsx`。 */
const CHAT_FILE_EXT =
  /\.(?:canvas\.tsx|docx|doc|pdf|xlsx|xls|pptx|ppt|md|txt|csv|json|html|png|jpe?g|webp|gif)$/i;

const BARE_FILE_RE =
  /^((?:[^\s/\\[\]()<>"'`，。；：、]+\/)*[^\s/\\[\]()<>"'`，。；：、]+\.(?:canvas\.tsx|docx|doc|pdf|xlsx|xls|pptx|ppt|md|txt|csv|json|html|png|jpe?g|webp|gif))(?::\d{1,6})?(?::\d{1,6})?/iu;

const LABEL_MAX = 300;
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

/** 公网 http(s)。内网、本机、带账号密码的地址返回 null。 */
export function publicWebUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return null;
  }
  if (isPrivateOrLocalHost(url.hostname)) {
    return null;
  }
  return url.toString();
}

export type WorkspacePathTarget = {
  path: string;
  line?: number;
  column?: number;
};

const LINE_SUFFIX = /:(\d{1,6})(?::(\d{1,6}))?$/;

/**
 * 工作区相对路径。末尾的 `:行` / `:行:列` 单独返回。
 * 绝对路径、盘符、`file:` 和其他 scheme、`..` 都拒绝。
 */
export function workspacePathTarget(href: string): WorkspacePathTarget | null {
  let raw = href.trim().replace(/\\/g, "/");
  if (!raw || raw.length > 300) {
    return null;
  }
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) < 32) {
      return null;
    }
  }
  raw = raw.replace(/^\.\//, "");
  let line: number | undefined;
  let column: number | undefined;
  const suffix = LINE_SUFFIX.exec(raw);
  if (suffix) {
    const parsedLine = Number(suffix[1]);
    const parsedColumn = suffix[2] ? Number(suffix[2]) : undefined;
    if (parsedLine >= 1 && parsedLine <= 100_000) {
      line = parsedLine;
      raw = raw.slice(0, suffix.index);
      if (parsedColumn && parsedColumn >= 1 && parsedColumn <= 10_000) {
        column = parsedColumn;
      }
    }
  }
  if (!raw || raw.startsWith("/") || raw.includes(":") || /\s/.test(raw)) {
    return null;
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  return {
    path: parts.join("/"),
    ...(line ? { line } : {}),
    ...(column ? { column } : {}),
  };
}

export function safeWorkspaceRelativePath(href: string): string | null {
  return workspacePathTarget(href)?.path ?? null;
}

/**
 * 工作区里交给 WPS 的相对路径。绝对路径、盘符、`..` 和其他后缀都拒绝。
 * 调用方先自行 `decodeURIComponent`。
 */
export function wpsDeliverablePath(href: string): string | null {
  let raw = href.trim().replace(/\\/g, "/");
  if (!raw || raw.length > 300) {
    return null;
  }
  for (let i = 0; i < raw.length; i += 1) {
    if (raw.charCodeAt(i) < 32) {
      return null;
    }
  }
  raw = raw.replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || raw.includes(":") || raw.includes("\0")) {
    return null;
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  if (!WPS_FILE_EXT.test(raw)) {
    return null;
  }
  return parts.join("/");
}

/** 对话里的 WPS 链接。路径先编码，避免空格把 Markdown 截断。 */
export function wpsDeliverableHref(relPath: string): string | null {
  const safe = wpsDeliverablePath(relPath);
  if (!safe) {
    return null;
  }
  return `lm-wps:${encodeURIComponent(safe)}`;
}

/**
 * 表格里文件名和目录分两列。拼成一条相对路径，左键才能打开那份稿。
 * 文件名里的加粗标记先去掉。
 */
export function docxCellWithDirectory(cell: string, row: readonly string[]): string {
  const dir = row.map((item) => item.trim()).find((item) => /^(?:[^/\s]+\/)+$/u.test(item));
  if (!dir) {
    return cell;
  }
  const plain = cell.trim().replace(/\*\*/g, "");
  if (!/^[^\s/]+\.docx$/iu.test(plain)) {
    return cell;
  }
  return `[${plain}](${dir.replace(/\/$/u, "")}/${plain})`;
}

/** 对话里可以点开的工作区文件。后缀不在名单里就不是链接。 */
export function workspaceChatFile(
  href: string,
): { path: string; canvas: boolean; line?: number; column?: number } | null {
  const target = workspacePathTarget(href);
  if (!target || !CHAT_FILE_EXT.test(target.path)) {
    return null;
  }
  return {
    path: target.path,
    canvas: /\.canvas\.tsx$/i.test(target.path),
    ...(target.line ? { line: target.line } : {}),
    ...(target.column ? { column: target.column } : {}),
  };
}

/** https 原文，且要么标题像法条，要么主机是法规站点。否则返回 null。 */
export function statuteJumpUrl(href: string, label: string): string | null {
  const url = publicWebUrl(href);
  if (!url?.startsWith("https:")) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!labelLooksLikeCite(label) && !hostLooksLegal(parsed.hostname)) {
    return null;
  }
  return url;
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

  if (/^lm-wps:/i.test(href)) {
    let decoded = href.slice("lm-wps:".length);
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return { link: { kind: "plain", label }, next };
    }
    const file = wpsDeliverablePath(decoded);
    if (!file) {
      return { link: { kind: "plain", label }, next };
    }
    return { link: { kind: "wps", label, path: file }, next };
  }

  if (/^https?:\/\//i.test(href)) {
    const url = publicWebUrl(href);
    if (!url) {
      return { link: { kind: "plain", label }, next };
    }
    return { link: { kind: "web", label, url }, next };
  }

  const file = workspaceChatFile(href);
  if (file) {
    if (!file.canvas && WPS_FILE_EXT.test(file.path)) {
      return { link: { kind: "wps", label, path: file.path }, next };
    }
    return {
      link: {
        kind: "file",
        label,
        path: file.path,
        canvas: file.canvas,
        ...(file.line ? { line: file.line } : {}),
        ...(file.column ? { column: file.column } : {}),
      },
      next,
    };
  }

  if (/^(javascript|data|file|vbscript):/i.test(href)) {
    return { link: { kind: "plain", label }, next };
  }

  return null;
}

function boundaryBefore(text: string, start: number): boolean {
  if (start <= 0) {
    return true;
  }
  const prev = text[start - 1] ?? "";
  if (/\p{Script=Han}/u.test(prev)) {
    return true;
  }
  return !/[\p{L}\p{N}_./-]/u.test(prev);
}

/** 句子里没写成 Markdown 的公网地址和工作区文件。点不开的不吃掉原文。 */
export function tryConsumeBareChatTarget(
  text: string,
  start: number,
): { link: LawyerChatLink; next: number } | null {
  if (!boundaryBefore(text, start)) {
    return null;
  }
  const rest = text.slice(start);
  if (/^https?:\/\//i.test(rest)) {
    const matched = /^https?:\/\/[^\s<>[\]"'`，。；、]+/iu.exec(rest);
    if (!matched?.[0]) {
      return null;
    }
    const body = matched[0].replace(/[.,;:!?。，、；：）】》>)}\]]+$/u, "");
    const url = publicWebUrl(body);
    if (!url) {
      return null;
    }
    return { link: { kind: "web", label: body, url }, next: start + body.length };
  }
  const fileMatch = BARE_FILE_RE.exec(rest);
  const raw = fileMatch?.[0];
  if (!raw) {
    return null;
  }
  const file = workspaceChatFile(raw);
  if (!file) {
    return null;
  }
  if (!file.canvas && WPS_FILE_EXT.test(file.path)) {
    return {
      link: { kind: "wps", label: raw, path: file.path },
      next: start + raw.length,
    };
  }
  return {
    link: {
      kind: "file",
      label: raw,
      path: file.path,
      canvas: file.canvas,
      ...(file.line ? { line: file.line } : {}),
      ...(file.column ? { column: file.column } : {}),
    },
    next: start + raw.length,
  };
}
