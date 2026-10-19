import { normalizeChatFolderRel } from "../../../../src/lawmind/agent/chat-folder.ts";

/** 设置里改了「新建对话」的目录后，侧栏立刻跟着换。 */
export const CHAT_HOME_DIR_EVENT = "lawmind:chat-home-dir";

const CHAT_HOME_DIR_KEY = "lawmind.chat.homeDir.v1";

export type ChatHomeDir = {
  /** 对话列表上的文件夹名。 */
  label: string | null;
  /** 悬停时给律师看的绝对路径。 */
  path: string | null;
  /**
   * 这个目录就在当前本机文件夹里面时，新建对话要带上的相对路径。
   * 工作区根目录、或目录不在本机文件夹里时为空。
   */
  folderRel?: string;
};

function homeDirStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    return null;
  }
  return storage;
}

/** 设置里选过的目录。没选过就是 null，调用方再用工作区根目录。 */
export function readChatHomeDir(): string | null {
  const storage = homeDirStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(CHAT_HOME_DIR_KEY)?.trim() ?? "";
    return raw || null;
  } catch {
    return null;
  }
}

export function writeChatHomeDir(path: string | null): void {
  const storage = homeDirStorage();
  if (!storage) {
    return;
  }
  const next = path?.trim() ?? "";
  if (!next) {
    if (typeof storage.removeItem === "function") {
      storage.removeItem(CHAT_HOME_DIR_KEY);
    } else {
      storage.setItem(CHAT_HOME_DIR_KEY, "");
    }
  } else {
    storage.setItem(CHAT_HOME_DIR_KEY, next);
  }
  window.dispatchEvent(new Event(CHAT_HOME_DIR_EVENT));
}

function absDir(raw: string | null | undefined): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

/** 把工作区内的相对目录拼成绝对路径。空相对路径就是工作区根目录。 */
export function chatWorkspacePath(base: string | null | undefined, folderRel?: string): string | undefined {
  const root = absDir(base);
  if (!root) {
    return undefined;
  }
  const rel = folderRel?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? "";
  return rel ? `${root}/${rel}` : root;
}

function basename(path: string): string | null {
  const name = path.split("/").filter((part) => part.length > 0).pop();
  return name || null;
}

/**
 * 最上面的「新建对话」放在哪。
 * 没在设置里另选时，用左侧工作区的根目录，不用它下面的子文件夹，也不用案件数据目录。
 * 选中的目录若在工作区里面且不是根，新建时带上相对路径。
 */
export function resolveChatHomeDir(input: {
  workspaceDir?: string | null;
  projectDir?: string | null;
  configured?: string | null;
}): ChatHomeDir {
  const workspace = absDir(input.workspaceDir);
  const project = absDir(input.projectDir);
  const chosen = absDir(input.configured) || project || workspace;
  if (!chosen) {
    return { label: null, path: null };
  }
  let folderRel: string | undefined;
  if (project && (chosen === project || chosen.startsWith(`${project}/`))) {
    folderRel = normalizeChatFolderRel(chosen.slice(project.length).replace(/^\/+/, ""));
  }
  return {
    label: basename(chosen),
    path: chosen,
    ...(folderRel ? { folderRel } : {}),
  };
}
