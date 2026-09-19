/**
 * Shared desk write helpers — HTTP confirm and agent tools call the same functions.
 */

import { loadMatter } from "../adapters/matter-storage/index.js";
import {
  listDeadlinesForMatter,
  recordDeadline,
  removeDeadlines,
} from "../application/services/deadline-service.js";
import {
  createMatterIfMissing,
  detachDeadlineIds,
  updateMatterProfile,
  type MatterProfileUpdateInput,
} from "../application/services/matter-write-service.js";
import { isValidMatterId } from "../cases/matter-id.js";
import { suggestDependsOnDeadlineId } from "./deadline-chain.js";
import {
  appendDeskWrite,
  loadDeskWrite,
  newDeskWriteId,
  type DeskWriteRecord,
  type MatterProfileSnapshot,
} from "./desk-write-journal.js";
import {
  compileIntakeBrief,
  confirmIntakeBrief,
  loadIntakeBrief,
  saveIntakeBrief,
  type IntakeBrief,
} from "./intake-brief.js";
import {
  defaultRemindBeforeHours,
  type ExtractedLegalEvent,
  type LegalEventKind,
} from "./legal-event-extract.js";
import type { MatterDocket, MatterKind } from "./matter-kind.js";

export type ApplyLegalEventInput = {
  eventKind: LegalEventKind;
  title: string;
  dueAt?: string;
  notes?: string;
};

export type ApplyLegalEventsResult =
  | {
      ok: true;
      writeId: string;
      deadlineIds: string[];
      deadlines: ReturnType<typeof listDeadlinesForMatter>;
    }
  | { ok: false; error: string; deadlineIds: string[] };

export type ApplyIntakeBriefResult =
  | { ok: true; writeId: string; brief: IntakeBrief }
  | { ok: false; error: string };

export type ApplyMatterProfileResult =
  | { ok: true; writeId: string; matterId: string }
  | { ok: false; error: string };

export type RevertDeskWriteResult =
  | { ok: true; writeId: string; kind: DeskWriteRecord["kind"] }
  | { ok: false; error: string };

export type CreateMatterFromIntakeResult =
  | { ok: true; writeId: string; matterId: string }
  | { ok: false; error: string };

function writableEvents(events: ApplyLegalEventInput[]): ApplyLegalEventInput[] {
  return events.filter((ev) => typeof ev.dueAt === "string" && ev.dueAt.trim().length > 0);
}

export async function applyLegalEvents(
  workspaceDir: string,
  matterId: string,
  events: ApplyLegalEventInput[],
  opts?: { createMatterIfMissing?: boolean },
): Promise<ApplyLegalEventsResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。", deadlineIds: [] };
  }
  const writable = writableEvents(events);
  if (writable.length === 0) {
    return { ok: false, error: "没有带日期的期限，未写入。", deadlineIds: [] };
  }
  const existing = loadMatter(workspaceDir, id);
  if (!existing && opts?.createMatterIfMissing !== true) {
    return { ok: false, error: "案件不存在，未写入期限。", deadlineIds: [] };
  }
  const previousHearingAt = existing?.docket?.hearingAt ?? null;
  const deadlineIds: string[] = [];
  let hearingDue: string | undefined;
  // 开庭先写，同批的上诉期才能挂到这次开庭（与确认抽取同一口径，见 deadline-service）。
  const ordered = [
    ...writable.filter((ev) => ev.eventKind === "hearing"),
    ...writable.filter((ev) => ev.eventKind !== "hearing"),
  ];
  const byTitle = new Map<string, string>();
  const pool = existing ? listDeadlinesForMatter(workspaceDir, id) : [];
  for (const ev of ordered) {
    const dependsOnDeadlineId = suggestDependsOnDeadlineId({
      eventKind: ev.eventKind,
      title: ev.title,
      dueAt: ev.dueAt!.trim(),
      candidates: pool,
    });
    const record = recordDeadline(
      workspaceDir,
      {
        matterId: id,
        title: ev.title,
        dueAt: ev.dueAt!.trim(),
        eventKind: ev.eventKind,
        notes: ev.notes,
        source: "document_extract",
        remindBeforeHours: defaultRemindBeforeHours(ev.eventKind),
        dependsOnDeadlineId,
      },
      { createMatterIfMissing: opts?.createMatterIfMissing === true },
    );
    deadlineIds.push(record.deadlineId);
    byTitle.set(ev.title, record.deadlineId);
    pool.push(record);
    if (ev.eventKind === "hearing" && !hearingDue) {
      hearingDue = record.dueAt;
    }
  }
  if (hearingDue) {
    const rec = loadMatter(workspaceDir, id);
    if (rec) {
      await updateMatterProfile(workspaceDir, {
        matterId: id,
        docket: { ...rec.docket, hearingAt: hearingDue },
      });
    }
  }
  const write = appendDeskWrite(workspaceDir, {
    writeId: newDeskWriteId(),
    matterId: id,
    kind: "legal_events",
    createdAt: new Date().toISOString(),
    deadlineIds,
    previousHearingAt,
  });
  return {
    ok: true,
    writeId: write.writeId,
    deadlineIds,
    deadlines: listDeadlinesForMatter(workspaceDir, id).filter((d) =>
      deadlineIds.includes(d.deadlineId),
    ),
  };
}

export async function applyIntakeBrief(
  workspaceDir: string,
  matterId: string,
): Promise<ApplyIntakeBriefResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  if (!loadMatter(workspaceDir, id)) {
    return { ok: false, error: "案件不存在，未写入谈话档案。" };
  }
  const previous = loadIntakeBrief(workspaceDir, id) ?? null;
  if (!previous) {
    return { ok: false, error: "还没有谈话摘要，请先整理谈话。" };
  }
  const brief = await confirmIntakeBrief(workspaceDir, id);
  if (!brief) {
    return { ok: false, error: "写入谈话档案失败。" };
  }
  const write = appendDeskWrite(workspaceDir, {
    writeId: newDeskWriteId(),
    matterId: id,
    kind: "intake_brief",
    createdAt: new Date().toISOString(),
    previousIntake: previous,
  });
  return { ok: true, writeId: write.writeId, brief };
}

export async function compileAndSaveIntakeBrief(input: {
  workspaceDir: string;
  matterId: string;
  transcript: string;
  source?: IntakeBrief["source"];
}): Promise<IntakeBrief | { ok: false; error: string }> {
  const id = input.matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  if (!loadMatter(input.workspaceDir, id)) {
    return { ok: false, error: "案件不存在。" };
  }
  const text = input.transcript.trim();
  if (!text) {
    return { ok: false, error: "谈话原文为空，未写入。" };
  }
  const brief = compileIntakeBrief({
    matterId: id,
    transcript: text,
    workspaceDir: input.workspaceDir,
  });
  if (input.source) {
    brief.source = input.source;
  }
  return saveIntakeBrief(input.workspaceDir, brief);
}

function snapshotProfile(
  matterId: string,
  workspaceDir: string,
): MatterProfileSnapshot | undefined {
  const rec = loadMatter(workspaceDir, matterId);
  if (!rec) {
    return undefined;
  }
  return {
    title: rec.title,
    clientId: rec.clientId,
    matterKind: rec.matterKind,
    docket: rec.docket,
  };
}

export async function applyMatterProfile(
  workspaceDir: string,
  input: MatterProfileUpdateInput,
): Promise<ApplyMatterProfileResult> {
  const id = input.matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "案件 ID 不合法。" };
  }
  const existing = loadMatter(workspaceDir, id);
  if (!existing) {
    return { ok: false, error: "案件不存在，未更新卷宗。" };
  }
  const previousProfile = snapshotProfile(id, workspaceDir);
  const saved = await updateMatterProfile(workspaceDir, input);
  if (!saved) {
    return { ok: false, error: "更新卷宗失败。" };
  }
  const write = appendDeskWrite(workspaceDir, {
    writeId: newDeskWriteId(),
    matterId: id,
    kind: "matter_profile",
    createdAt: new Date().toISOString(),
    previousProfile,
  });
  return { ok: true, writeId: write.writeId, matterId: id };
}

function matterIdFromTitle(title: string): string {
  const t = title.trim().slice(0, 80);
  if (isValidMatterId(t)) {
    return t;
  }
  const slug = t.replace(/[\\/]/g, "").replace(/\s+/g, " ").trim();
  if (isValidMatterId(slug)) {
    return slug;
  }
  return `matter-${Date.now().toString(36)}`;
}

export async function createMatterFromIntake(input: {
  workspaceDir: string;
  title: string;
  matterKind?: MatterKind;
}): Promise<CreateMatterFromIntakeResult> {
  const title = input.title.trim();
  if (!title) {
    return { ok: false, error: "新建案件需要标题。" };
  }
  let matterId = matterIdFromTitle(title);
  let n = 0;
  while (loadMatter(input.workspaceDir, matterId)) {
    n += 1;
    const suffix = `-${n + 1}`;
    const base = matterIdFromTitle(title).slice(0, 128 - suffix.length);
    matterId = `${base}${suffix}`;
    if (n > 20) {
      return { ok: false, error: "无法分配新的案件 ID。" };
    }
  }
  createMatterIfMissing(input.workspaceDir, {
    matterId,
    title,
    matterKind: input.matterKind,
  });
  const write = appendDeskWrite(input.workspaceDir, {
    writeId: newDeskWriteId(),
    matterId,
    kind: "create_matter",
    createdAt: new Date().toISOString(),
  });
  return { ok: true, writeId: write.writeId, matterId };
}

export async function revertDeskWrite(
  workspaceDir: string,
  matterId: string,
  writeId: string,
): Promise<RevertDeskWriteResult> {
  const id = matterId.trim();
  const record = loadDeskWrite(workspaceDir, id, writeId.trim());
  if (!record) {
    return { ok: false, error: "找不到这次写入，无法撤销。" };
  }
  if (record.kind === "legal_events") {
    const ids = record.deadlineIds ?? [];
    if (ids.length > 0) {
      removeDeadlines(workspaceDir, id, ids);
      detachDeadlineIds(workspaceDir, id, ids);
    }
    const rec = loadMatter(workspaceDir, id);
    if (rec) {
      const docket: MatterDocket = { ...rec.docket };
      if (record.previousHearingAt) {
        docket.hearingAt = record.previousHearingAt;
      } else {
        delete docket.hearingAt;
      }
      await updateMatterProfile(workspaceDir, { matterId: id, docket });
    }
    return { ok: true, writeId: record.writeId, kind: record.kind };
  }
  if (record.kind === "intake_brief") {
    if (record.previousIntake) {
      await saveIntakeBrief(workspaceDir, record.previousIntake);
    } else {
      const cur = loadIntakeBrief(workspaceDir, id);
      if (cur) {
        await saveIntakeBrief(workspaceDir, { ...cur, confirmedAt: undefined });
      }
    }
    return { ok: true, writeId: record.writeId, kind: record.kind };
  }
  if (record.kind === "matter_profile") {
    const snap = record.previousProfile;
    if (snap) {
      await updateMatterProfile(workspaceDir, {
        matterId: id,
        title: snap.title,
        clientId: snap.clientId,
        matterKind: snap.matterKind,
        docket: snap.docket,
      });
    }
    return { ok: true, writeId: record.writeId, kind: record.kind };
  }
  if (record.kind === "organize_files") {
    // 反向回放移动/重命名；目标已不存在则跳过并如实报告（不伪造还原）。
    const ops = record.organizeOps ?? [];
    if (ops.length === 0) {
      return { ok: false, error: "这次整理没有记录可撤销的文件操作。" };
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const materialsRoot = path.join(workspaceDir, "cases", id, "materials");
    const undone: string[] = [];
    const skipped: string[] = [];
    for (const op of ops.toReversed()) {
      const toAbs = path.resolve(materialsRoot, op.to);
      const fromAbs = path.resolve(materialsRoot, op.from);
      if (!toAbs.startsWith(materialsRoot) || !fromAbs.startsWith(materialsRoot)) {
        skipped.push(`${op.to}（越界）`);
        continue;
      }
      if (!fs.existsSync(toAbs)) {
        skipped.push(`${op.to}（已不存在）`);
        continue;
      }
      fs.mkdirSync(path.dirname(fromAbs), { recursive: true });
      fs.renameSync(toAbs, fromAbs);
      undone.push(op.from);
    }
    if (undone.length === 0) {
      return { ok: false, error: `没有可还原的文件操作（${skipped.join("；") || "全部跳过"}）。` };
    }
    return { ok: true, writeId: record.writeId, kind: record.kind };
  }
  return { ok: false, error: "新建的卷宗不能用撤销自动删除，请在工作台处理。" };
}

export function eventsFromExtracted(events: ExtractedLegalEvent[]): ApplyLegalEventInput[] {
  return events.map((ev) => ({
    eventKind: ev.eventKind,
    title: ev.title,
    dueAt: ev.dueAt,
    notes: ev.notes,
  }));
}
