import { chatFolderGroupKey, normalizeChatWorkDir } from "../../../../src/lawmind/agent/chat-folder.ts";

export type ChatFolderGroup<T> = {
  key: string;
  /** 没有标题时，这些对话直接列在「对话」下面。 */
  label: string | null;
  /** 工作区或子文件夹。对话上方用文件夹图标，和 Cursor 的工作区标题同一层。 */
  folder: boolean;
  /** 这组对话绑定的工作区绝对路径。旧的相对路径分组没有这一项。 */
  workDir?: string;
  sessions: T[];
};

/** 本机文件夹路径的最后一段，用作对话列表上的工作区名。 */
export function workspaceFolderName(projectDir: string | null | undefined): string | null {
  if (typeof projectDir !== "string") {
    return null;
  }
  const parts = projectDir
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..");
  return parts[parts.length - 1] ?? null;
}

/**
 * 对话按各自绑定的工作区分组。
 * 新建时写入的绝对路径单独成组。早先只写了相对路径的对话仍按那个相对路径分组，不改写。
 * 两边都没有的旧对话不另起标题，也不补挂到当前工作区。
 */
export function groupSideChatSessions<
  T extends { folderRel?: string | null; matterId?: string | null; workDir?: string | null },
>(
  sessions: readonly T[],
  opts?: {
    matterTitleById?: Record<string, string>;
    knownMatterIds?: ReadonlySet<string> | null;
    /** @deprecated 不再把未绑定的对话改挂到当前文件夹。保留参数以免旧调用报错。 */
    workspaceFolderLabel?: string | null;
    /** 设置里的默认工作区。有对话时排在最前。 */
    preferredWorkDir?: string | null;
  },
): ChatFolderGroup<T>[] {
  const unbound: T[] = [];
  const workspaces = new Map<string, T[]>();
  const folders = new Map<string, T[]>();
  const matters = new Map<string, T[]>();
  for (const session of sessions) {
    const workDir = normalizeChatWorkDir(session.workDir);
    if (workDir) {
      const list = workspaces.get(workDir) ?? [];
      list.push(session);
      workspaces.set(workDir, list);
      continue;
    }
    const folder = chatFolderGroupKey(session.folderRel);
    if (folder) {
      const list = folders.get(folder) ?? [];
      list.push(session);
      folders.set(folder, list);
      continue;
    }
    const matterId = session.matterId?.trim() ?? "";
    const known = opts?.knownMatterIds;
    const matterKnown = Boolean(matterId) && (!known || known.has(matterId));
    if (matterKnown) {
      const list = matters.get(matterId) ?? [];
      list.push(session);
      matters.set(matterId, list);
      continue;
    }
    unbound.push(session);
  }
  const groups: ChatFolderGroup<T>[] = [];
  const preferred = normalizeChatWorkDir(opts?.preferredWorkDir);
  const workspaceKeys = [...workspaces.keys()].toSorted((a, b) => {
    if (preferred && a === preferred) {
      return -1;
    }
    if (preferred && b === preferred) {
      return 1;
    }
    const left = workspaceFolderName(a) ?? a;
    const right = workspaceFolderName(b) ?? b;
    return left.localeCompare(right, "zh");
  });
  for (const workDir of workspaceKeys) {
    groups.push({
      key: `work:${workDir}`,
      label: workspaceFolderName(workDir),
      folder: true,
      workDir,
      sessions: workspaces.get(workDir) ?? [],
    });
  }
  if (unbound.length > 0) {
    groups.push({
      key: "unbound",
      label: null,
      folder: false,
      sessions: unbound,
    });
  }
  for (const key of [...folders.keys()].toSorted((a, b) => a.localeCompare(b, "zh"))) {
    groups.push({ key: `folder:${key}`, label: key, folder: true, sessions: folders.get(key) ?? [] });
  }
  const matterKeys = [...matters.keys()].toSorted((a, b) => {
    const left = opts?.matterTitleById?.[a] || a;
    const right = opts?.matterTitleById?.[b] || b;
    return left.localeCompare(right, "zh");
  });
  for (const key of matterKeys) {
    groups.push({
      key: `matter:${key}`,
      label: opts?.matterTitleById?.[key] || key,
      folder: false,
      sessions: matters.get(key) ?? [],
    });
  }
  return groups;
}

const SIDE_CHAT_MINUTE = 60_000;
const SIDE_CHAT_HOUR = 3_600_000;
const SIDE_CHAT_DAY = 86_400_000;

/** 侧栏窄，悬停时用短时间：刚刚 / 5 分 / 3 时 / 2 天。 */
export function sideChatAgeLabel(iso: string | undefined, now = Date.now()): string | null {
  if (!iso?.trim()) {
    return null;
  }
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) {
    return null;
  }
  const diff = now - at;
  if (diff < SIDE_CHAT_MINUTE) {
    return "刚刚";
  }
  if (diff < SIDE_CHAT_HOUR) {
    return `${Math.max(1, Math.floor(diff / SIDE_CHAT_MINUTE))} 分`;
  }
  if (diff < SIDE_CHAT_DAY) {
    return `${Math.floor(diff / SIDE_CHAT_HOUR)} 时`;
  }
  if (diff < 7 * SIDE_CHAT_DAY) {
    return `${Math.floor(diff / SIDE_CHAT_DAY)} 天`;
  }
  const day = new Date(at);
  return `${day.getMonth() + 1}月${day.getDate()}日`;
}

/** 悬停文件夹时：几场对话，以及其中最近的一次。 */
export function sideChatFolderHoverMeta(
  sessions: readonly { updatedAt?: string }[],
  now = Date.now(),
): string {
  let latest = "";
  for (const session of sessions) {
    const iso = session.updatedAt?.trim() ?? "";
    if (iso > latest) {
      latest = iso;
    }
  }
  const count = `${sessions.length} 场`;
  const age = sideChatAgeLabel(latest, now);
  return age ? `${count} · ${age}` : count;
}

/** 悬停提示里的路径。工作区用本机文件夹全路径，子文件夹接在后面。 */
export function sideChatFolderTitle(input: {
  label: string;
  folder: boolean;
  workspace?: boolean;
  workspaceFolderPath?: string | null;
}): string {
  const path = input.workspaceFolderPath?.trim().replace(/[\\/]+$/, "") ?? "";
  if (input.workspace && path) {
    return path;
  }
  if (input.folder && path) {
    return `${path}/${input.label}`;
  }
  return input.label;
}
