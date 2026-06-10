import type { FileChatContextItem } from "./lawmind-app-shell";
import type { WorkflowTemplateItem } from "./LawmindWorkflowLibrary";

export type ComposeContextMatterOption = {
  matterId: string;
  displayName: string;
  latestUpdatedAt?: string;
};

export type ComposeContextPickerCategory = "files" | "matters" | "templates";

export type ComposeContextPickerItem =
  | {
      kind: "file";
      id: string;
      category: "files";
      label: string;
      hint?: string;
      root: FileChatContextItem["root"];
      relPath: string;
      fileKind: FileChatContextItem["kind"];
      alreadyPinned?: boolean;
    }
  | {
      kind: "matter";
      id: string;
      category: "matters";
      label: string;
      hint?: string;
      matterId: string;
      isCurrent?: boolean;
    }
  | {
      kind: "template";
      id: string;
      category: "templates";
      label: string;
      hint?: string;
      templateId: string;
      starterPrompt?: string;
    };

const RECENT_FILE_CONTEXT_KEY = "lawmind.compose.recentFileContext";

export function readRecentFileContextPaths(): Array<
  Pick<FileChatContextItem, "root" | "relPath" | "kind">
> {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(RECENT_FILE_CONTEXT_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const e = entry as Record<string, unknown>;
        const root = e.root === "project" ? "project" : e.root === "workspace" ? "workspace" : null;
        const relPath = typeof e.relPath === "string" ? e.relPath : "";
        const kind = e.kind === "directory" ? "directory" : e.kind === "file" ? "file" : null;
        if (!root || !kind) {
          return null;
        }
        return { root, relPath, kind };
      })
      .filter((x): x is Pick<FileChatContextItem, "root" | "relPath" | "kind"> => x !== null)
      .slice(0, 12);
  } catch {
    return [];
  }
}

export function rememberFileContextPath(
  payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">,
): void {
  if (typeof window === "undefined") {
    return;
  }
  const prev = readRecentFileContextPaths().filter(
    (x) => !(x.root === payload.root && x.relPath === payload.relPath && x.kind === payload.kind),
  );
  const next = [payload, ...prev].slice(0, 12);
  window.localStorage.setItem(RECENT_FILE_CONTEXT_KEY, JSON.stringify(next));
}

export function parseAtTrigger(
  input: string,
  cursorPos: number,
): { query: string; startIndex: number } | null {
  const before = input.slice(0, Math.max(0, cursorPos));
  const match = before.match(/@([\w\u4e00-\u9fff./\\_-]*)$/);
  if (!match) {
    return null;
  }
  const token = match[0];
  return { query: match[1] ?? "", startIndex: before.length - token.length };
}

export function removeAtTokenFromInput(
  input: string,
  startIndex: number,
  cursorPos: number,
): { nextInput: string; nextCursor: number } {
  const before = input.slice(0, startIndex);
  const after = input.slice(cursorPos);
  const nextInput = `${before}${after}`;
  return { nextInput, nextCursor: before.length };
}

export function filterContextPickerItems(
  items: ComposeContextPickerItem[],
  query: string,
): ComposeContextPickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return items;
  }
  return items.filter((item) => {
    const hay = `${item.label} ${item.hint ?? ""} ${item.id}`.toLowerCase();
    return hay.includes(q);
  });
}

export function buildComposeContextPickerItems(opts: {
  pinnedFiles: FileChatContextItem[];
  recentFiles: Array<Pick<FileChatContextItem, "root" | "relPath" | "kind">>;
  matters: ComposeContextMatterOption[];
  contextMatterId: string | null;
  templates: WorkflowTemplateItem[];
}): ComposeContextPickerItem[] {
  const pinnedIds = new Set(opts.pinnedFiles.map((f) => `${f.root}|${f.relPath}|${f.kind}`));
  const fileItems: ComposeContextPickerItem[] = [];
  const seenFile = new Set<string>();

  const pushFile = (
    payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">,
    alreadyPinned?: boolean,
  ) => {
    const key = `${payload.root}|${payload.relPath}|${payload.kind}`;
    if (seenFile.has(key)) {
      return;
    }
    seenFile.add(key);
    const scope = payload.root === "workspace" ? "工作区" : "项目";
    const kindLabel = payload.kind === "directory" ? "目录" : "文件";
    fileItems.push({
      kind: "file",
      id: `file:${key}`,
      category: "files",
      label: payload.relPath || scope,
      hint: `${scope} · ${kindLabel}`,
      root: payload.root,
      relPath: payload.relPath,
      fileKind: payload.kind,
      alreadyPinned: alreadyPinned ?? pinnedIds.has(key),
    });
  };

  for (const f of opts.pinnedFiles) {
    pushFile(f, true);
  }
  for (const f of opts.recentFiles) {
    pushFile(f);
  }

  const sortedMatters = [...opts.matters].toSorted((a, b) => {
    const ta = Date.parse(a.latestUpdatedAt ?? "") || 0;
    const tb = Date.parse(b.latestUpdatedAt ?? "") || 0;
    return tb - ta;
  });

  const matterItems: ComposeContextPickerItem[] = sortedMatters.map((m) => ({
    kind: "matter",
    id: `matter:${m.matterId}`,
    category: "matters",
    label: m.displayName.trim() || m.matterId,
    hint: m.displayName.trim() && m.displayName.trim() !== m.matterId ? m.matterId : "案件",
    matterId: m.matterId,
    isCurrent: opts.contextMatterId === m.matterId,
  }));

  const templateItems: ComposeContextPickerItem[] = opts.templates.map((t) => ({
    kind: "template",
    id: `template:${t.id}`,
    category: "templates",
    label: t.name,
    hint: t.description?.trim() || t.deliverableType || "工作流模板",
    templateId: t.id,
    starterPrompt: t.starterPrompt,
  }));

  return [...fileItems, ...matterItems, ...templateItems];
}

export function groupContextPickerItems(
  items: ComposeContextPickerItem[],
): Array<{ category: ComposeContextPickerCategory; label: string; items: ComposeContextPickerItem[] }> {
  const groups: Array<{
    category: ComposeContextPickerCategory;
    label: string;
    items: ComposeContextPickerItem[];
  }> = [
    { category: "files", label: "文件", items: [] },
    { category: "matters", label: "案件", items: [] },
    { category: "templates", label: "模板", items: [] },
  ];
  for (const item of items) {
    const group = groups.find((g) => g.category === item.category);
    group?.items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

export function matterComposeChipLabel(matterId: string, displayName?: string | null): string {
  const name = displayName?.trim();
  if (name && name !== matterId) {
    return name.length <= 28 ? name : `${name.slice(0, 14)}…${name.slice(-8)}`;
  }
  return matterId.length <= 24 ? matterId : `${matterId.slice(0, 10)}…${matterId.slice(-6)}`;
}
