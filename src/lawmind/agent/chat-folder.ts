const CHAT_FOLDER_REL_MAX = 400;

/**
 * 对话挂在本机文件夹下的相对路径。
 * 空、绝对路径、`..` 都丢掉：顶栏新建的对话不挂任何文件夹。
 */
export function normalizeChatFolderRel(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  // 绝对路径不是本机文件夹里的相对位置，挂上去会把对话分到「Users」这类假分组。
  if (
    !text ||
    text.startsWith("/") ||
    /^[A-Za-z]:/.test(text) ||
    text.length > CHAT_FOLDER_REL_MAX
  ) {
    return undefined;
  }
  const parts = text.split("/").filter((part) => part.length > 0);
  if (
    parts.length === 0 ||
    parts.some((part) => part === "." || part === ".." || part.includes("\0"))
  ) {
    return undefined;
  }
  return parts.join("/");
}

const CHAT_WORK_DIR_MAX = 500;

/**
 * 一场新对话绑定的工作区绝对路径。只在新建时写入。
 * 已有对话没有这个字段时保持原样，不回填。
 */
export function normalizeChatWorkDir(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const text = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!text || text.length > CHAT_WORK_DIR_MAX) {
    return undefined;
  }
  const unix = text.startsWith("/");
  const drive = /^[A-Za-z]:\//.test(text);
  if (!unix && !drive) {
    return undefined;
  }
  const parts = text.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    return undefined;
  }
  return unix ? `/${parts.join("/")}` : parts.join("/");
}

/** 侧栏分组用案件文件夹的第一段。`甲案/证据` 仍归在「甲案」下。 */
export function chatFolderGroupKey(folderRel: string | null | undefined): string | null {
  const norm = normalizeChatFolderRel(folderRel);
  if (!norm) {
    return null;
  }
  return norm.split("/")[0] ?? null;
}
