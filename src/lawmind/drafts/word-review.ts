/**
 * 审阅稿核对侧车：一份原件一份待核对。
 * 成功写出审阅稿时打开；律师从修订窗口导出覆盖后写上 closedAt。
 * 已关闭的不再重新打开。
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { captureStanceFromRedline, captureStanceRejection } from "../stance/capture.js";
import { invalidateDraftListCache, listDrafts, persistDraft, readDraft } from "./index.js";
import {
  LAWYER_SURFACE_RATIONALE,
  readRedlineProposal,
  type RedlineHunk,
} from "./redline-proposal.js";
import { reviewFileRel, wordCheckMarker } from "./word-review-marker.js";

export { reviewFileRel, splitWordCheckMarkers, wordCheckMarker } from "./word-review-marker.js";

export type WordReviewTicket = {
  schemaVersion: 1;
  taskId: string;
  baselineRel: string;
  baselineRoot: "workspace" | "project";
  reviewAbs: string;
  openedAt: string;
  closedAt?: string;
};

function safeTaskId(taskId: string): string | undefined {
  const id = taskId.trim();
  if (!id || id.length > 200 || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return undefined;
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    return undefined;
  }
  return id;
}

export function wordReviewPath(workspaceDir: string, taskId: string): string | undefined {
  const id = safeTaskId(taskId);
  if (!id) {
    return undefined;
  }
  return path.join(path.resolve(workspaceDir), "drafts", `${id}.word-review.json`);
}

export function readWordReview(workspaceDir: string, taskId: string): WordReviewTicket | undefined {
  const file = wordReviewPath(workspaceDir, taskId);
  if (!file) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<WordReviewTicket>;
    const id = safeTaskId(taskId);
    if (!id || parsed.schemaVersion !== 1 || parsed.taskId !== id) {
      return undefined;
    }
    const baselineRel = parsed.baselineRel?.trim().replace(/\\/g, "/");
    const reviewAbs = parsed.reviewAbs?.trim();
    const openedAt = parsed.openedAt?.trim();
    if (!baselineRel || !reviewAbs || !openedAt) {
      return undefined;
    }
    const closedAt = parsed.closedAt?.trim();
    return {
      schemaVersion: 1,
      taskId: id,
      baselineRel,
      baselineRoot: parsed.baselineRoot === "project" ? "project" : "workspace",
      reviewAbs,
      openedAt,
      ...(closedAt ? { closedAt } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * 已有审阅稿与修订、但侧车是在功能上线前写的：补开待核对，避免在办里看不到。
 */
export function syncWordReviewTicketsFromDrafts(workspaceDir: string): void {
  invalidateDraftListCache(workspaceDir);
  for (const draft of listDrafts(workspaceDir)) {
    const taskId = draft.taskId?.trim();
    const baselineRel = draft.contractEdit?.baselineRelativePath?.trim().replace(/\\/g, "/");
    const reviewAbs = draft.outputPath?.trim();
    if (!taskId || !baselineRel || !reviewAbs) {
      continue;
    }
    const existing = readWordReview(workspaceDir, taskId);
    if (existing?.closedAt) {
      continue;
    }
    const live = liveHunks(workspaceDir, taskId);
    if (live.length === 0) {
      if (existing && !existing.closedAt) {
        closeWordReviewTicket(workspaceDir, taskId);
      }
      continue;
    }
    if (!existing) {
      openWordReviewTicket({ workspaceDir, taskId, reviewAbs });
    }
  }
}

export function listOpenWordReviews(workspaceDir: string): WordReviewTicket[] {
  const dir = path.join(path.resolve(workspaceDir), "drafts");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const open: WordReviewTicket[] = [];
  for (const name of names) {
    if (!name.endsWith(".word-review.json")) {
      continue;
    }
    const taskId = name.slice(0, -".word-review.json".length);
    const ticket = readWordReview(workspaceDir, taskId);
    if (ticket && !ticket.closedAt) {
      open.push(ticket);
    }
  }
  return open;
}

function normRel(rel: string): string {
  return rel.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Same original baseline → keep editing that open review copy (no new `_02`). */
export function findOpenWordReviewForBaseline(
  workspaceDir: string,
  baselineRel: string,
): WordReviewTicket | undefined {
  const want = normRel(baselineRel);
  if (!want) {
    return undefined;
  }
  for (const ticket of listOpenWordReviews(workspaceDir)) {
    if (normRel(ticket.baselineRel) === want) {
      return ticket;
    }
  }
  return undefined;
}

/**
 * Resolve an open review when the lawyer pins either the original baseline or
 * the working copy (including a renamed sibling in the same folder).
 */
export function findOpenWordReviewForPin(
  workspaceDir: string,
  pinPath: string,
): WordReviewTicket | undefined {
  const raw = pinPath.trim();
  if (!raw) {
    return undefined;
  }
  const asRel = normRel(raw);
  const byBaseline = findOpenWordReviewForBaseline(workspaceDir, asRel);
  if (byBaseline) {
    return byBaseline;
  }
  const pinBase = path.basename(asRel);
  for (const ticket of listOpenWordReviews(workspaceDir)) {
    const reviewAbs = path.resolve(ticket.reviewAbs);
    const reviewDir = path.dirname(reviewAbs);
    const pinAbs = path.isAbsolute(raw)
      ? path.resolve(raw)
      : path.resolve(reviewDir, path.basename(asRel));
    if (reviewAbs === pinAbs || normRel(path.basename(reviewAbs)) === pinBase) {
      return ticket;
    }
    // Lawyer renamed the working copy: reviewAbs missing, pin is another .docx
    // in the same folder that is not the original baseline leaf.
    const baselineLeaf = path.basename(normRel(ticket.baselineRel));
    if (
      /\.docx$/i.test(pinBase) &&
      pinBase !== baselineLeaf &&
      !fs.existsSync(reviewAbs) &&
      fs.existsSync(pinAbs) &&
      path.dirname(pinAbs) === reviewDir
    ) {
      return ticket;
    }
  }
  return undefined;
}

/** Point the open ticket at a renamed working copy; original baseline stays. */
export function adoptWordReviewAbs(params: {
  workspaceDir: string;
  taskId: string;
  reviewAbs: string;
}): { ok: boolean; ticket?: WordReviewTicket; reason?: string } {
  const existing = readWordReview(params.workspaceDir, params.taskId);
  if (!existing || existing.closedAt) {
    return { ok: false, reason: existing?.closedAt ? "closed" : "missing" };
  }
  const reviewAbs = params.reviewAbs.trim();
  if (!reviewAbs || !fs.existsSync(reviewAbs)) {
    return { ok: false, reason: "missing_file" };
  }
  const ticket: WordReviewTicket = { ...existing, reviewAbs: path.resolve(reviewAbs) };
  const file = wordReviewPath(params.workspaceDir, params.taskId);
  if (!file) {
    return { ok: false, reason: "invalid" };
  }
  writeJsonAtomic(file, ticket);
  const draft = readDraft(params.workspaceDir, params.taskId);
  if (draft && draft.outputPath !== ticket.reviewAbs) {
    persistDraft(params.workspaceDir, { ...draft, outputPath: ticket.reviewAbs });
  }
  return { ok: true, ticket };
}

function liveHunks(workspaceDir: string, taskId: string): RedlineHunk[] {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  return (proposal?.hunks ?? []).filter((hunk) => hunk.status !== "rejected");
}

export function openWordReviewTicket(params: {
  workspaceDir: string;
  taskId: string;
  reviewAbs: string;
}): { opened: boolean; ticket?: WordReviewTicket; reason?: string } {
  const taskId = safeTaskId(params.taskId);
  const reviewAbs = params.reviewAbs.trim();
  if (!taskId || !reviewAbs) {
    return { opened: false, reason: "invalid" };
  }
  const existing = readWordReview(params.workspaceDir, taskId);
  if (existing?.closedAt) {
    return { opened: false, reason: "closed", ticket: existing };
  }
  const draft = readDraft(params.workspaceDir, taskId);
  const baselineRel = draft?.contractEdit?.baselineRelativePath?.trim().replace(/\\/g, "/");
  if (!draft || !baselineRel || !draft.outputPath?.trim()) {
    return { opened: false, reason: "no_baseline" };
  }
  if (liveHunks(params.workspaceDir, taskId).length === 0) {
    return { opened: false, reason: "no_hunks" };
  }
  const ticket: WordReviewTicket = {
    schemaVersion: 1,
    taskId,
    baselineRel,
    baselineRoot: draft.contractEdit?.baselineRoot === "project" ? "project" : "workspace",
    reviewAbs,
    openedAt: existing?.openedAt ?? new Date().toISOString(),
  };
  const file = wordReviewPath(params.workspaceDir, taskId);
  if (!file) {
    return { opened: false, reason: "invalid" };
  }
  writeJsonAtomic(file, ticket);
  return { opened: true, ticket };
}

export function closeWordReviewTicket(
  workspaceDir: string,
  taskId: string,
): { closed: boolean; ticket?: WordReviewTicket } {
  const existing = readWordReview(workspaceDir, taskId);
  if (!existing) {
    return { closed: false };
  }
  if (existing.closedAt) {
    return { closed: true, ticket: existing };
  }
  const ticket: WordReviewTicket = { ...existing, closedAt: new Date().toISOString() };
  const file = wordReviewPath(workspaceDir, taskId);
  if (!file) {
    return { closed: false };
  }
  writeJsonAtomic(file, ticket);
  return { closed: true, ticket };
}

export function openWordCheckMarker(workspaceDir: string, taskId: string): string | undefined {
  const ticket = readWordReview(workspaceDir, taskId);
  if (!ticket || ticket.closedAt) {
    return undefined;
  }
  return wordCheckMarker(ticket.taskId, reviewFileRel(ticket.baselineRel, ticket.reviewAbs));
}

export function appendOpenWordCheckMarkers(params: {
  workspaceDir: string;
  reply: string;
  taskIds: Iterable<string>;
}): string {
  const extra: string[] = [];
  for (const taskId of params.taskIds) {
    const mark = openWordCheckMarker(params.workspaceDir, taskId);
    if (mark && !params.reply.includes(mark) && !extra.includes(mark)) {
      extra.push(mark);
    }
  }
  if (extra.length === 0) {
    return params.reply;
  }
  return [params.reply, ...extra].filter((line) => line.trim()).join("\n\n");
}

/** 导出覆盖审阅稿之后：按收口差额记偏好，并让在办那一行消失。 */
export function finishWordReviewExport(workspaceDir: string, taskId: string): void {
  const ticket = readWordReview(workspaceDir, taskId);
  if (!ticket || ticket.closedAt) {
    return;
  }
  const proposal = readRedlineProposal(workspaceDir, taskId);
  if (proposal) {
    for (const hunk of proposal.hunks) {
      const lawyer = hunk.rationale === LAWYER_SURFACE_RATIONALE;
      if (hunk.status === "accepted" && lawyer) {
        captureStanceFromRedline({
          workspaceDir,
          matterId: proposal.matterId,
          hunk,
        });
        continue;
      }
      if (lawyer || hunk.proposedAfter == null) {
        continue;
      }
      if (hunk.status === "accepted" && hunk.after !== hunk.proposedAfter) {
        captureStanceFromRedline({
          workspaceDir,
          matterId: proposal.matterId,
          hunk,
        });
        continue;
      }
      if (hunk.status === "rejected") {
        captureStanceRejection({
          workspaceDir,
          matterId: proposal.matterId,
          hunk,
          avoidedLanguage: hunk.proposedAfter,
        });
      }
    }
  }
  closeWordReviewTicket(workspaceDir, taskId);
}
