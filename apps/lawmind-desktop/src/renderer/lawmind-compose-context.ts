import type { FileChatContextItem } from "./lawmind-app-shell";
import type { WorkflowTemplateItem } from "./lawmind-workflow-types";
import type { TruthSourceContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import { makeContextPinId } from "../../../../src/lawmind/platform/compose-context-pin.ts";

export type ComposeContextMatterOption = {
  matterId: string;
  displayName: string;
  latestUpdatedAt?: string;
};

export type ComposeContextPickerCategory =
  | "files"
  | "matters"
  | "templates"
  | "evidence"
  | "clause"
  | "playbook"
  | "theory";

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
    }
  | {
      kind: "evidence";
      id: string;
      category: "evidence";
      label: string;
      hint?: string;
      matterId: string;
      relPath: string;
      alreadyPinned?: boolean;
    }
  | {
      kind: "clause";
      id: string;
      category: "clause";
      label: string;
      hint?: string;
      scope: "full" | "section";
      sectionHeading?: string;
      alreadyPinned?: boolean;
    }
  | {
      kind: "playbook";
      id: string;
      category: "playbook";
      label: string;
      hint?: string;
      playbookId: string;
      alreadyPinned?: boolean;
    }
  | {
      kind: "theory";
      id: string;
      category: "theory";
      label: string;
      hint?: string;
      matterId: string;
      alreadyPinned?: boolean;
    };

export type ComposeTruthPinOption = TruthSourceContextPin;

export const CLAUSE_PLAYBOOK_PIN_SECTIONS = [
  "## 6. LawMind 审核学习（自动摘要）",
] as const;

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
  pinnedTruthPins?: TruthSourceContextPin[];
  evidencePaths?: Array<{ relPath: string; label?: string; hint?: string }>;
  fleetPlaybooks?: Array<{ id: string; label: string }>;
  /** When set, only emit these categories (e.g. meeting materials → files only). */
  categories?: ComposeContextPickerCategory[];
}): ComposeContextPickerItem[] {
  const allow = opts.categories?.length
    ? new Set(opts.categories)
    : null;
  const allowCat = (c: ComposeContextPickerCategory) => !allow || allow.has(c);

  const pinnedIds = new Set(opts.pinnedFiles.map((f) => `${f.root}|${f.relPath}|${f.kind}`));
  const pinnedTruthIds = new Set((opts.pinnedTruthPins ?? []).map((p) => makeContextPinId(p)));
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

  if (allowCat("files")) {
    for (const f of opts.pinnedFiles) {
      pushFile(f, true);
    }
    for (const f of opts.recentFiles) {
      pushFile(f);
    }
  }

  const matterItems: ComposeContextPickerItem[] = allowCat("matters")
    ? [...opts.matters]
        .toSorted((a, b) => {
          const ta = Date.parse(a.latestUpdatedAt ?? "") || 0;
          const tb = Date.parse(b.latestUpdatedAt ?? "") || 0;
          return tb - ta;
        })
        .map((m) => ({
          kind: "matter" as const,
          id: `matter:${m.matterId}`,
          category: "matters" as const,
          label: m.displayName.trim() || m.matterId,
          hint: m.displayName.trim() && m.displayName.trim() !== m.matterId ? m.matterId : "案件",
          matterId: m.matterId,
          isCurrent: opts.contextMatterId === m.matterId,
        }))
    : [];

  const templateItems: ComposeContextPickerItem[] = allowCat("templates")
    ? opts.templates.map((t) => ({
        kind: "template" as const,
        id: `template:${t.id}`,
        category: "templates" as const,
        label: t.name,
        hint: t.description?.trim() || t.deliverableType || "工作流模板",
        templateId: t.id,
        starterPrompt: t.starterPrompt,
      }))
    : [];

  const matterId = opts.contextMatterId?.trim() || null;

  const evidenceItems: ComposeContextPickerItem[] =
    allowCat("evidence") && matterId
      ? (opts.evidencePaths ?? []).map((entry) => {
          const pin: TruthSourceContextPin = {
            pinKind: "evidence",
            matterId,
            relPath: entry.relPath,
          };
          const pinId = makeContextPinId(pin);
          return {
            kind: "evidence" as const,
            id: `evidence:${pinId}`,
            category: "evidence" as const,
            label: entry.label?.trim() || entry.relPath,
            hint: entry.hint ?? "案件材料",
            matterId,
            relPath: entry.relPath,
            alreadyPinned: pinnedTruthIds.has(pinId),
          };
        })
      : [];

  const clauseItems: ComposeContextPickerItem[] = allowCat("clause")
    ? [
        {
          kind: "clause" as const,
          id: "clause:full",
          category: "clause" as const,
          label: "条款审查要点（整册）",
          hint: "playbooks/CLAUSE_PLAYBOOK.md",
          scope: "full" as const,
          alreadyPinned: pinnedTruthIds.has(makeContextPinId({ pinKind: "clause", scope: "full" })),
        },
        ...CLAUSE_PLAYBOOK_PIN_SECTIONS.map((heading) => ({
          kind: "clause" as const,
          id: `clause:section:${heading}`,
          category: "clause" as const,
          label: heading.replace(/^##\s+/, ""),
          hint: "CLAUSE_PLAYBOOK 片段",
          scope: "section" as const,
          sectionHeading: heading,
          alreadyPinned: pinnedTruthIds.has(
            makeContextPinId({ pinKind: "clause", scope: "section", sectionHeading: heading }),
          ),
        })),
      ]
    : [];

  const playbookItems: ComposeContextPickerItem[] = allowCat("playbook")
    ? (opts.fleetPlaybooks ?? []).map((pb) => ({
        kind: "playbook" as const,
        id: `playbook:${pb.id}`,
        category: "playbook" as const,
        label: pb.label,
        hint: "标准审查剧本",
        playbookId: pb.id,
        alreadyPinned: pinnedTruthIds.has(
          makeContextPinId({ pinKind: "playbook", playbookId: pb.id }),
        ),
      }))
    : [];

  const theoryItems: ComposeContextPickerItem[] =
    allowCat("theory") && matterId
      ? [
          {
            kind: "theory" as const,
            id: `theory:${matterId}`,
            category: "theory" as const,
            label: "本案策略 MATTER_STRATEGY",
            hint: `cases/${matterId}/MATTER_STRATEGY.md`,
            matterId,
            alreadyPinned: pinnedTruthIds.has(
              makeContextPinId({ pinKind: "theory", matterId }),
            ),
          },
        ]
      : [];

  return [
    ...fileItems,
    ...evidenceItems,
    ...clauseItems,
    ...playbookItems,
    ...theoryItems,
    ...matterItems,
    ...templateItems,
  ];
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
    { category: "evidence", label: "证据材料", items: [] },
    { category: "clause", label: "条款审查要点", items: [] },
    { category: "playbook", label: "审查模板", items: [] },
    { category: "theory", label: "本案理论", items: [] },
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

export function truthPinToPayload(item: ComposeContextPickerItem): TruthSourceContextPin | null {
  if (item.kind === "evidence") {
    return { pinKind: "evidence", matterId: item.matterId, relPath: item.relPath };
  }
  if (item.kind === "clause") {
    return {
      pinKind: "clause",
      scope: item.scope,
      ...(item.sectionHeading ? { sectionHeading: item.sectionHeading } : {}),
    };
  }
  if (item.kind === "playbook") {
    return { pinKind: "playbook", playbookId: item.playbookId };
  }
  if (item.kind === "theory") {
    return { pinKind: "theory", matterId: item.matterId };
  }
  return null;
}

export function formatTruthPinChip(
  pin: TruthSourceContextPin,
): { id: string; shortLabel: string; title: string } {
  const id = makeContextPinId(pin);
  switch (pin.pinKind) {
    case "evidence":
      return {
        id,
        shortLabel: `📎 ${pin.relPath.split("/").pop() ?? pin.relPath}`,
        title: `证据材料 · cases/${pin.matterId}/${pin.relPath}`,
      };
    case "clause":
      return {
        id,
        shortLabel: pin.scope === "full" ? "📚 条款审查要点" : "📚 条款片段",
        title:
          pin.scope === "full"
            ? "条款审查要点（整册）"
            : `条款审查要点片段 · ${pin.sectionHeading ?? ""}`,
      };
    case "playbook":
      return {
        id,
        shortLabel: `🎭 ${pin.playbookId}`,
        title: `审查模板 · ${pin.playbookId}`,
      };
    case "theory":
      return {
        id,
        shortLabel: "🧭 本案策略",
        title: `本案理论 · cases/${pin.matterId}/MATTER_STRATEGY.md`,
      };
    default: {
      const _exhaustive: never = pin;
      return { id: String(_exhaustive), shortLabel: "钉选", title: "钉选" };
    }
  }
}
