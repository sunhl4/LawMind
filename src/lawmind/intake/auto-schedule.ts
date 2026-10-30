/**
 * 来件里已经写明日期的期限，归案后直接登记进提醒。
 * 同时在在办开一张核对卡，律师可以改时间或划掉。
 * 把握低的「案件期限」兜底不写，避免把无关日期登记成期限。
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import {
  listDeadlinesForMatter,
  recordDeadline,
} from "../application/services/deadline-service.js";
import { updateMatterProfile } from "../application/services/matter-write-service.js";
import {
  listQueueItemsForMatter,
  openQueueItem,
} from "../application/services/queue-write-service.js";
import {
  defaultRemindBeforeHours,
  extractLegalEvents,
  type ExtractedLegalEvent,
} from "../desk/legal-event-extract.js";
import type { IntakeItem } from "./types.js";

function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && left === right;
}

function formatDue(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  const shifted = new Date(t + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function openReview(workspaceDir: string, matterId: string, detail: string): void {
  const title = "核对已登记的期限";
  const open = listQueueItemsForMatter(workspaceDir, matterId, {
    kind: "need_client_input",
    status: "open",
  });
  if (open.some((item) => item.title === title)) {
    return;
  }
  openQueueItem(workspaceDir, {
    matterId,
    kind: "need_client_input",
    title,
    priority: "high",
    detail: detail.slice(0, 500),
  });
}

function writableEvents(text: string): ExtractedLegalEvent[] {
  return extractLegalEvents(text).filter(
    (event) => event.confidence !== "low" && Boolean(event.dueAt?.trim()),
  );
}

/** 登记新期限。同一类、同一时刻已有记录则跳过；同类同时刻不同则只开核对卡，不覆盖。 */
export async function recordIntakeDeadlines(
  workspaceDir: string,
  matterId: string,
  item: IntakeItem,
  corpus: string,
): Promise<string[]> {
  const events = writableEvents(corpus);
  if (events.length === 0) {
    return [];
  }
  const existing = listDeadlinesForMatter(workspaceDir, matterId);
  const recorded: Array<{ title: string; dueAt: string }> = [];
  let conflict = false;
  for (const event of events) {
    const dueAt = event.dueAt?.trim() ?? "";
    if (!dueAt) {
      continue;
    }
    const sameKind = existing.filter(
      (row) => row.eventKind === event.eventKind && row.status !== "missed",
    );
    if (sameKind.some((row) => sameInstant(row.dueAt, dueAt))) {
      continue;
    }
    if (sameKind.some((row) => row.title === event.title && !sameInstant(row.dueAt, dueAt))) {
      conflict = true;
      continue;
    }
    const quote = (event.notes ?? corpus).replace(/\s+/g, " ").trim().slice(0, 240);
    const saved = recordDeadline(workspaceDir, {
      matterId,
      title: event.title,
      dueAt,
      eventKind: event.eventKind,
      notes: `来件 ${item.id}：${quote}`,
      source: "document_extract",
      remindBeforeHours: defaultRemindBeforeHours(event.eventKind),
    });
    existing.push(saved);
    recorded.push({ title: saved.title, dueAt: saved.dueAt });
    if (event.eventKind === "hearing") {
      const matter = loadMatter(workspaceDir, matterId);
      if (matter && !matter.docket?.hearingAt) {
        await updateMatterProfile(workspaceDir, {
          matterId,
          docket: { ...matter.docket, hearingAt: saved.dueAt },
        });
      }
    }
  }
  if (recorded.length > 0 || conflict) {
    const lines = recorded.map((row) => `${row.title} ${formatDue(row.dueAt)}`);
    const detail = [
      lines.length > 0 ? `已写入提醒：${lines.join("；")}。` : "",
      conflict ? "来件里的时间和卷宗已有期限不一致，未覆盖。" : "",
      "可在工作台的提醒里改时间或划掉。",
    ]
      .filter(Boolean)
      .join("");
    openReview(workspaceDir, matterId, detail);
  }
  return recorded.map((row) => row.title);
}
