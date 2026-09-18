/**
 * Deadline chains + lawyer-facing source labels.
 *
 * One optional predecessor per row (not a queue DAG). Hearings are never gated.
 * Release is computed at read time: completing the predecessor surfaces the next
 * item on today/remind. The 期限 tab still lists gated rows.
 */

import type { DeadlineRecord } from "../adapters/matter-storage/schemas.js";

export const DEADLINE_SOURCE_LABELS: Record<DeadlineRecord["source"], string> = {
  manual: "律师手记",
  case_memory: "本案档案",
  project_file: "卷宗文件",
  calendar_import: "日历导入",
  document_extract: "传票抽取",
};

const APPEAL_LIMITATION_RE = /上诉|再审|不变期间|法定期间/;

export type DeadlineChainFields = {
  deadlineId: string;
  title?: string;
  eventKind?: string;
  status?: string;
  dueAt?: string;
  dependsOnDeadlineId?: string;
};

export type DeskDeadlineView = DeadlineRecord & {
  sourceLabel: string;
  released: boolean;
  waitingOnTitle?: string;
};

export function deadlineSourceLabel(source: DeadlineRecord["source"] | string | undefined): string {
  if (!source) {
    return "";
  }
  return DEADLINE_SOURCE_LABELS[source as DeadlineRecord["source"]] ?? source;
}

export function isAppealLimitation(eventKind?: string, title?: string): boolean {
  return eventKind === "limitation" && APPEAL_LIMITATION_RE.test(title ?? "");
}

export function wouldCreateDeadlineCycle(
  deadlineId: string,
  dependsOnDeadlineId: string,
  all: DeadlineChainFields[],
): boolean {
  let current: string | undefined = dependsOnDeadlineId;
  const seen = new Set<string>();
  while (current) {
    if (current === deadlineId) {
      return true;
    }
    if (seen.has(current)) {
      // Existing loop elsewhere — not a cycle through this node.
      return false;
    }
    seen.add(current);
    const pred = all.find((row) => row.deadlineId === current);
    current = pred?.dependsOnDeadlineId?.trim() || undefined;
  }
  return false;
}

export function sanitizeDeadlineDependsOn(
  record: DeadlineChainFields,
  all: DeadlineChainFields[],
): string | undefined {
  if (record.eventKind === "hearing") {
    return undefined;
  }
  const raw = record.dependsOnDeadlineId?.trim() ?? "";
  if (!raw || raw === record.deadlineId || raw.length > 64) {
    return undefined;
  }
  if (!all.some((row) => row.deadlineId === raw)) {
    return undefined;
  }
  if (wouldCreateDeadlineCycle(record.deadlineId, raw, all)) {
    return undefined;
  }
  return raw;
}

export function isDeadlineReleased(
  deadline: DeadlineChainFields,
  all: DeadlineChainFields[],
): boolean {
  if (deadline.eventKind === "hearing") {
    return true;
  }
  const predId = deadline.dependsOnDeadlineId?.trim();
  if (!predId || predId === deadline.deadlineId) {
    return true;
  }
  const pred = all.find((row) => row.deadlineId === predId);
  if (!pred) {
    return true;
  }
  return pred.status === "completed";
}

export function deadlineWaitingOnTitle(
  deadline: DeadlineChainFields,
  all: DeadlineChainFields[],
): string | undefined {
  if (isDeadlineReleased(deadline, all)) {
    return undefined;
  }
  const pred = all.find((row) => row.deadlineId === deadline.dependsOnDeadlineId?.trim());
  const title = pred?.title?.trim();
  return title || undefined;
}

export function suggestDependsOnDeadlineId(input: {
  eventKind?: string;
  title?: string;
  dueAt: string;
  candidates: DeadlineChainFields[];
}): string | undefined {
  if (!isAppealLimitation(input.eventKind, input.title)) {
    return undefined;
  }
  const due = Date.parse(input.dueAt);
  const hearings = input.candidates.filter((row) => {
    if (row.eventKind !== "hearing") {
      return false;
    }
    if (row.status && row.status !== "open" && row.status !== "snoozed" && row.status !== "completed") {
      return false;
    }
    const hearingAt = Date.parse(row.dueAt ?? "");
    if (Number.isNaN(due) || Number.isNaN(hearingAt)) {
      return false;
    }
    return hearingAt <= due;
  });
  if (hearings.length === 0) {
    return undefined;
  }
  hearings.sort((a, b) => Date.parse(b.dueAt ?? "") - Date.parse(a.dueAt ?? ""));
  return hearings[0]?.deadlineId;
}

export function annotateDeskDeadline(
  deadline: DeadlineRecord,
  all: DeadlineChainFields[],
): DeskDeadlineView {
  const waitingOnTitle = deadlineWaitingOnTitle(deadline, all);
  return {
    ...deadline,
    sourceLabel: deadlineSourceLabel(deadline.source),
    released: isDeadlineReleased(deadline, all),
    ...(waitingOnTitle ? { waitingOnTitle } : {}),
  };
}

export function annotateDeskDeadlines(deadlines: DeadlineRecord[]): DeskDeadlineView[] {
  return deadlines.map((row) => annotateDeskDeadline(row, deadlines));
}
