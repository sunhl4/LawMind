/**
 * 待发出跟案件走。数据仍是 action-summary 里的待发信和本轮发信批准，不另建一份清单。
 */
import type { ActionSummaryPayload } from "./lawmind-requires-action";

export const LAWMIND_OPEN_MATTER_OUTBOUND = "lawmind:open-matter-outbound";
export const LAWMIND_OUTBOUND_CHANGED = "lawmind:outbound-changed";

export type DeskOutboundItem = {
  /** inbox：交办待发信；turn：这一轮停住的发信。 */
  source: "inbox" | "turn";
  id: string;
  sessionId?: string;
  matterId: string;
  title: string;
  to: string;
  subject: string;
  attachments: string[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function attachmentsOf(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/** 工作区里还没发出的信，按案件分组。 */
export function pendingOutboundItems(summary: ActionSummaryPayload | null | undefined): DeskOutboundItem[] {
  const out: DeskOutboundItem[] = [];
  const seen = new Set<string>();
  for (const item of summary?.automationInbox ?? []) {
    const pending = item.pendingSend;
    const matterId = item.matterId?.trim() ?? "";
    if (item.status !== "open" || !pending?.to?.trim() || !matterId) {
      continue;
    }
    const key = `inbox:${item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      source: "inbox",
      id: item.id,
      matterId,
      title: item.title?.trim() || "待发出",
      to: pending.to.trim(),
      subject: pending.subject?.trim() || "",
      attachments: attachmentsOf(pending.attachmentRelativePaths),
    });
  }
  for (const item of summary?.toolApprovals ?? []) {
    if (item.toolName?.trim() !== "send_email") {
      continue;
    }
    const matterId = item.matterId?.trim() ?? "";
    if (!matterId || !item.actionId?.trim() || !item.sessionId?.trim()) {
      continue;
    }
    const args = item.toolArgs ?? {};
    const key = `turn:${item.actionId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      source: "turn",
      id: item.actionId,
      sessionId: item.sessionId,
      matterId,
      title: item.title?.trim() || "待发出",
      to: text(args.to) || text(args.recipient),
      subject: text(args.subject),
      attachments: [
        ...attachmentsOf(args.attachmentRelativePaths),
        ...attachmentsOf(args.attachments),
      ],
    });
  }
  return out;
}

export function outboundCountByMatter(items: DeskOutboundItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.matterId, (counts.get(item.matterId) ?? 0) + 1);
  }
  return counts;
}

export function notifyOutboundChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(LAWMIND_OUTBOUND_CHANGED));
}

export function requestOpenMatterOutbound(matterId: string): void {
  const id = matterId.trim();
  if (!id || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<{ matterId: string }>(LAWMIND_OPEN_MATTER_OUTBOUND, {
      detail: { matterId: id },
    }),
  );
}
