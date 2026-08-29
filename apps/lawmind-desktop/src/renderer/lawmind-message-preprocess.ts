/**
 * Chat message preprocessing pipeline (Claude Messages.tsx inspired).
 * Normalizes, reorders clarification, collapses search results, groups tools, brief filter.
 */

import type { ChatMsg } from "./lawmind-chat";
import { getPendingClarificationState } from "./lawmind-chat";

export type RenderableChatItem =
  | { kind: "message"; message: ChatMsg; sourceIndex: number }
  | { kind: "tool_group"; messages: ChatMsg[]; sourceIndices: number[]; collapsed: boolean }
  | { kind: "compact_notice"; label: string; sourceIndex: number };

export type PreprocessOptions = {
  briefOnly?: boolean;
  collapseSearch?: boolean;
  groupTools?: boolean;
};

const SEARCH_TOOL_MARKERS = ["search_workspace", "read_project_file", "analyze_document"];
const DELIVERABLE_MARKERS = [
  "draft_document",
  "render_document",
  "execute_workflow",
  "research_task",
  "update_draft",
];

function normalizeMessages(messages: ChatMsg[]): Array<{ message: ChatMsg; sourceIndex: number }> {
  return messages.map((message, sourceIndex) => ({ message, sourceIndex }));
}

function promoteClarification(
  rows: Array<{ message: ChatMsg; sourceIndex: number }>,
): Array<{ message: ChatMsg; sourceIndex: number }> {
  const pending = getPendingClarificationState(rows.map((r) => r.message));
  if (!pending.pending || pending.assistantMessageIndex < 0) {
    return rows;
  }
  const idx = pending.assistantMessageIndex;
  const row = rows[idx];
  if (!row) {
    return rows;
  }
  const rest = rows.filter((_, i) => i !== idx);
  return [row, ...rest];
}

function isSearchHeavyMessage(message: ChatMsg): boolean {
  const seq = message.toolCallSequence ?? [];
  if (seq.length < 20) {
    return false;
  }
  const searchHits = seq.filter((name) =>
    SEARCH_TOOL_MARKERS.some((m) => name.includes(m)),
  ).length;
  return searchHits >= 10;
}

function collapseSearchResults(
  rows: Array<{ message: ChatMsg; sourceIndex: number }>,
  enabled: boolean,
): RenderableChatItem[] {
  if (!enabled) {
    return rows.map((r) => ({ kind: "message" as const, message: r.message, sourceIndex: r.sourceIndex }));
  }
  const out: RenderableChatItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row && isSearchHeavyMessage(row.message)) {
      const group: typeof rows = [row];
      let j = i + 1;
      while (j < rows.length && isSearchHeavyMessage(rows[j].message)) {
        group.push(rows[j]);
        j += 1;
      }
      if (group.length > 1) {
        out.push({
          kind: "tool_group",
          messages: group.map((g) => g.message),
          sourceIndices: group.map((g) => g.sourceIndex),
          collapsed: true,
        });
        i = j;
        continue;
      }
    }
    out.push({ kind: "message", message: row.message, sourceIndex: row.sourceIndex });
    i += 1;
  }
  return out;
}

function isToolOnlyAssistant(message: ChatMsg): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  const seq = message.toolCallSequence ?? [];
  const hasTools = seq.length > 0;
  const textLen = (message.text ?? "").trim().length;
  return hasTools && textLen < 40;
}

function groupToolActivities(items: RenderableChatItem[], enabled: boolean): RenderableChatItem[] {
  if (!enabled) {
    return items;
  }
  const out: RenderableChatItem[] = [];
  let buffer: RenderableChatItem[] = [];

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    if (buffer.length === 1) {
      out.push(buffer[0]);
    } else {
      const messages: ChatMsg[] = [];
      const sourceIndices: number[] = [];
      for (const item of buffer) {
        if (item.kind === "message") {
          messages.push(item.message);
          sourceIndices.push(item.sourceIndex);
        }
      }
      if (messages.length > 0) {
        out.push({ kind: "tool_group", messages, sourceIndices, collapsed: true });
      }
    }
    buffer = [];
  };

  for (const item of items) {
    if (item.kind === "message" && isToolOnlyAssistant(item.message)) {
      buffer.push(item);
    } else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

function messageHasDeliverableSignal(message: ChatMsg): boolean {
  const seq = message.toolCallSequence ?? [];
  if (seq.some((name) => DELIVERABLE_MARKERS.some((m) => name.includes(m)))) {
    return true;
  }
  if ((message.gateDecisions?.length ?? 0) > 0) {
    return true;
  }
  if (message.requiresAction?.some((a) => a.kind === "tool_approval")) {
    return true;
  }
  const t = message.text ?? "";
  return /交付|草稿|验收|render|draft|workflow/i.test(t);
}

function filterBriefDeliverables(items: RenderableChatItem[]): RenderableChatItem[] {
  const kept = new Set<number>();
  for (const item of items) {
    if (item.kind === "message") {
      if (item.message.role === "user" || messageHasDeliverableSignal(item.message)) {
        kept.add(item.sourceIndex);
      }
    } else if (item.kind === "tool_group") {
      for (const idx of item.sourceIndices) {
        const m = item.messages[item.sourceIndices.indexOf(idx)];
        if (m && messageHasDeliverableSignal(m)) {
          for (const si of item.sourceIndices) {
            kept.add(si);
          }
        }
      }
    }
  }
  if (kept.size === 0) {
    return items.slice(-6);
  }
  return items.filter((item) => {
    if (item.kind === "message") {
      return kept.has(item.sourceIndex);
    }
    if (item.kind === "tool_group") {
      return item.sourceIndices.some((i) => kept.has(i));
    }
    return true;
  });
}

export function preprocessChatMessages(
  messages: ChatMsg[],
  opts: PreprocessOptions = {},
): RenderableChatItem[] {
  const collapseSearch = opts.collapseSearch !== false;
  const groupTools = opts.groupTools !== false;

  let rows = normalizeMessages(messages);
  rows = promoteClarification(rows);
  let items = collapseSearchResults(rows, collapseSearch);
  items = groupToolActivities(items, groupTools);
  if (opts.briefOnly) {
    items = filterBriefDeliverables(items);
  }
  return items;
}

export const BRIEF_ONLY_STORAGE_KEY = "lawmind.ui.briefOnly.v1";

export function readBriefOnlyPreference(): boolean {
  try {
    return localStorage.getItem(BRIEF_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBriefOnlyPreference(value: boolean): void {
  try {
    localStorage.setItem(BRIEF_ONLY_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}
