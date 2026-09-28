/**
 * Redline / tracked-change proposals for review workbench.
 * Supports section-level and surgical (span) hunks for minimal contract edits.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic, withExclusiveFileLock } from "../adapters/matter-storage/io.js";
import type { ArtifactDraft, ArtifactSection } from "../types.js";
import { persistDraft, readDraft } from "./index.js";
import { computeMinimalEditSpans } from "./minimal-edit-script.js";
import { appendProvenanceEvent, createProvenanceEvent, diffSummary } from "./provenance.js";
import { applySpanToBody, splitSurgicalEditSpans } from "./surgical-diff.js";

export type RedlineHunkStatus = "pending" | "accepted" | "rejected";

/** 律师在正文里改出的修订。没有模型提议，收口时按律师自己的写法记例子。 */
export const LAWYER_SURFACE_RATIONALE = "律师在正文里改的";

export type RedlineHunk = {
  hunkId: string;
  sectionIndex: number;
  sectionHeading?: string;
  before: string;
  after: string;
  /**
   * 模型第一次写出的改法。之后律师改 `after` 不再覆盖这里。
   * 收口时只在它和律师最终写法不同时记偏好。
   */
  proposedAfter?: string;
  rationale?: string;
  status: RedlineHunkStatus;
  /** Baseline-relative span (surgical mode). */
  spanStart?: number;
  spanEnd?: number;
  /** `surgical` = minimal span; `section` = whole section body. */
  granularity?: "surgical" | "section";
};

export type RedlineProposal = {
  taskId: string;
  matterId?: string;
  baselineSections: ArtifactSection[];
  hunks: RedlineHunk[];
  updatedAt: string;
};

export function redlineProposalPath(workspaceDir: string, taskId: string): string {
  return path.join(path.resolve(workspaceDir), "drafts", `${taskId}.redline.json`);
}

export function readRedlineProposal(
  workspaceDir: string,
  taskId: string,
): RedlineProposal | undefined {
  try {
    const raw = fs.readFileSync(redlineProposalPath(workspaceDir, taskId), "utf8");
    return JSON.parse(raw) as RedlineProposal;
  } catch {
    return undefined;
  }
}

/**
 * A sentence the lawyer typed in the open document. Same hunk list the rail
 * and the tracked Word export already use.
 */
export function appendLawyerHunk(
  workspaceDir: string,
  taskId: string,
  edit: { before: string; after: string },
): { ok: true; proposal: RedlineProposal; hunkId: string } | { ok: false; error: string } {
  const before = edit.before;
  const after = edit.after;
  if (!before.trim() || before.length > REVISE_AFTER_MAX || after.length > REVISE_AFTER_MAX) {
    return { ok: false, error: "invalid_edit" };
  }
  if (before === after) {
    return { ok: false, error: "unchanged" };
  }
  return withExclusiveFileLock(redlineProposalLockPath(workspaceDir, taskId), () => {
    const draft = readDraft(workspaceDir, taskId);
    if (!draft) {
      return { ok: false, error: "draft_not_found" };
    }
    const proposal = readRedlineProposal(workspaceDir, taskId) ?? {
      taskId,
      ...(draft.matterId ? { matterId: draft.matterId } : {}),
      baselineSections: draft.sections.map((section) => ({ ...section })),
      hunks: [],
      updatedAt: new Date().toISOString(),
    };
    const existing = proposal.hunks.find(
      (hunk) =>
        hunk.before === before &&
        hunk.status !== "rejected" &&
        hunk.rationale === LAWYER_SURFACE_RATIONALE,
    );
    if (existing) {
      existing.after = after;
      existing.status = "pending";
      proposal.updatedAt = new Date().toISOString();
      writeRedlineProposal(workspaceDir, proposal);
      return { ok: true, proposal, hunkId: existing.hunkId };
    }
    const hunkId = randomUUID();
    proposal.hunks.push({
      hunkId,
      sectionIndex: 0,
      sectionHeading: before.replace(/\s+/g, " ").trim().slice(0, 24) || "正文",
      before,
      after,
      rationale: LAWYER_SURFACE_RATIONALE,
      status: "pending",
      granularity: "surgical",
    });
    proposal.updatedAt = new Date().toISOString();
    writeRedlineProposal(workspaceDir, proposal);
    return { ok: true, proposal, hunkId };
  });
}

/**
 * Replace every lawyer-made document edit with the paragraphs that still differ
 * from the original. A paragraph typed back to the original drops its revision.
 */
export function replaceLawyerHunks(
  workspaceDir: string,
  taskId: string,
  edits: { before: string; after: string }[],
):
  | { ok: true; proposal: RedlineProposal; removed: number; updated: number }
  | { ok: false; error: string } {
  const nextEdits = edits.filter(
    (edit) =>
      edit.before.trim() &&
      edit.before !== edit.after &&
      edit.before.length <= REVISE_AFTER_MAX &&
      edit.after.length <= REVISE_AFTER_MAX,
  );
  return withExclusiveFileLock(redlineProposalLockPath(workspaceDir, taskId), () => {
    const draft = readDraft(workspaceDir, taskId);
    if (!draft) {
      return { ok: false, error: "draft_not_found" };
    }
    const proposal = readRedlineProposal(workspaceDir, taskId) ?? {
      taskId,
      ...(draft.matterId ? { matterId: draft.matterId } : {}),
      baselineSections: draft.sections.map((section) => ({ ...section })),
      hunks: [],
      updatedAt: new Date().toISOString(),
    };
    const removed = proposal.hunks.filter(
      (hunk) => hunk.rationale === LAWYER_SURFACE_RATIONALE,
    ).length;
    const kept = proposal.hunks.filter((hunk) => hunk.rationale !== LAWYER_SURFACE_RATIONALE);
    const added = nextEdits.map((edit) => ({
      hunkId: randomUUID(),
      sectionIndex: 0,
      sectionHeading: edit.before.replace(/\s+/g, " ").trim().slice(0, 24) || "正文",
      before: edit.before,
      after: edit.after,
      rationale: LAWYER_SURFACE_RATIONALE,
      status: "pending" as const,
      granularity: "surgical" as const,
    }));
    proposal.hunks = [...kept, ...added];
    proposal.updatedAt = new Date().toISOString();
    writeRedlineProposal(workspaceDir, proposal);
    return { ok: true, proposal, removed, updated: added.length };
  });
}

export function writeRedlineProposal(workspaceDir: string, proposal: RedlineProposal): string {
  const target = redlineProposalPath(workspaceDir, proposal.taskId);
  writeJsonAtomic(target, proposal);
  return target;
}

function redlineProposalLockPath(workspaceDir: string, taskId: string): string {
  return `${redlineProposalPath(workspaceDir, taskId)}.lock`;
}

export function summarizeRedline(proposal: RedlineProposal | undefined): {
  pending: number;
  accepted: number;
  rejected: number;
} {
  if (!proposal) {
    return { pending: 0, accepted: 0, rejected: 0 };
  }
  let pending = 0;
  let accepted = 0;
  let rejected = 0;
  for (const h of proposal.hunks) {
    if (h.status === "accepted") {
      accepted++;
    } else if (h.status === "rejected") {
      rejected++;
    } else {
      pending++;
    }
  }
  return { pending, accepted, rejected };
}

function sectionsEqual(a: ArtifactSection[], b: ArtifactSection[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((s, i) => s.heading === b[i]?.heading && s.body === b[i]?.body);
}

function useSurgicalMode(draft: ArtifactDraft): boolean {
  const mode = draft.contractEdit?.mode;
  if (mode === "section") {
    return false;
  }
  // Default surgical when contractEdit is set; also for contract.* deliverables.
  if (draft.contractEdit) {
    return true;
  }
  const dt = draft.deliverableType ?? "";
  return dt.startsWith("contract.");
}

function findPriorHunk(
  existing: RedlineProposal | undefined,
  sectionIndex: number,
  span: { spanStart?: number; spanEnd?: number; before: string; after: string },
): RedlineHunk | undefined {
  if (!existing) {
    return undefined;
  }
  return existing.hunks.find((h) => {
    if (h.sectionIndex !== sectionIndex || h.status === "pending") {
      return false;
    }
    if (
      typeof span.spanStart === "number" &&
      typeof h.spanStart === "number" &&
      h.spanStart === span.spanStart &&
      h.spanEnd === span.spanEnd
    ) {
      return true;
    }
    return h.before === span.before && h.after === span.after && h.granularity !== "surgical";
  });
}

/** 模型原句只记一次。律师后来改 `after` 时，这里保持第一次的写法。 */
function proposedAfterField(
  prior: RedlineHunk | undefined,
  modelAfter: string,
): { proposedAfter: string } | Record<string, never> {
  if (prior?.rationale === LAWYER_SURFACE_RATIONALE) {
    return prior.proposedAfter != null ? { proposedAfter: prior.proposedAfter } : {};
  }
  return { proposedAfter: prior?.proposedAfter ?? prior?.after ?? modelAfter };
}

export function generateRedlineProposal(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const existing = readRedlineProposal(workspaceDir, taskId);
  const baseline = existing?.baselineSections?.length
    ? existing.baselineSections
    : draft.sections.map((s) => ({ ...s }));
  const surgical = useSurgicalMode(draft);
  const hunks: RedlineHunk[] = [];
  const maxLen = Math.max(baseline.length, draft.sections.length);
  for (let i = 0; i < maxLen; i++) {
    const beforeFull = baseline[i]?.body ?? "";
    const afterFull = draft.sections[i]?.body ?? "";
    if (beforeFull === afterFull) {
      continue;
    }
    const heading = draft.sections[i]?.heading ?? baseline[i]?.heading;
    if (surgical) {
      const spans = splitSurgicalEditSpans(beforeFull, afterFull);
      if (spans.length === 0) {
        continue;
      }
      for (const span of spans) {
        const prior = findPriorHunk(existing, i, span);
        if (prior) {
          hunks.push({
            ...prior,
            before: span.before,
            after: span.after,
            ...proposedAfterField(prior, span.after),
            spanStart: span.spanStart,
            spanEnd: span.spanEnd,
            granularity: "surgical",
          });
          continue;
        }
        hunks.push({
          hunkId: randomUUID(),
          sectionIndex: i,
          sectionHeading: heading,
          before: span.before,
          after: span.after,
          proposedAfter: span.after,
          spanStart: span.spanStart,
          spanEnd: span.spanEnd,
          granularity: "surgical",
          status: "pending",
        });
      }
      continue;
    }
    const prior = findPriorHunk(existing, i, { before: beforeFull, after: afterFull });
    if (prior) {
      hunks.push({
        ...prior,
        before: beforeFull,
        after: afterFull,
        ...proposedAfterField(prior, afterFull),
        granularity: "section",
      });
      continue;
    }
    hunks.push({
      hunkId: randomUUID(),
      sectionIndex: i,
      sectionHeading: heading,
      before: beforeFull,
      after: afterFull,
      proposedAfter: afterFull,
      granularity: "section",
      status: "pending",
    });
  }
  const proposal: RedlineProposal = {
    taskId,
    matterId: draft.matterId,
    baselineSections: baseline,
    hunks,
    updatedAt: new Date().toISOString(),
  };
  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal };
}

export function resolveRedlineHunk(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  decision: "accept" | "reject",
): { ok: true; proposal: RedlineProposal; draft?: ArtifactDraft } | { ok: false; error: string } {
  // 排他锁包住「读提案 → 改正文/baseline → 写提案」整段，避免并行 accept/reject 互踩。
  return withExclusiveFileLock(redlineProposalLockPath(workspaceDir, taskId), () =>
    resolveRedlineHunkUnlocked(workspaceDir, taskId, hunkId, decision),
  );
}

function resolveRedlineHunkUnlocked(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  decision: "accept" | "reject",
): { ok: true; proposal: RedlineProposal; draft?: ArtifactDraft } | { ok: false; error: string } {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  if (!proposal) {
    return { ok: false, error: "redline_not_found" };
  }
  const hunk = proposal.hunks.find((h) => h.hunkId === hunkId);
  if (!hunk) {
    return { ok: false, error: "hunk_not_found" };
  }
  if (hunk.status !== "pending") {
    const next = decision === "accept" ? "accepted" : "rejected";
    if (hunk.status === next) {
      return { ok: true, proposal, draft: readDraft(workspaceDir, taskId) };
    }
    // 接受和拒绝都可以改口。已经点过的条目再点另一边，正文跟 baseline 跟着换回去。
    return retargetResolvedHunkUnlocked(workspaceDir, proposal, hunk, decision);
  }

  hunk.status = decision === "accept" ? "accepted" : "rejected";
  proposal.updatedAt = new Date().toISOString();

  let draft: ArtifactDraft | undefined = readDraft(workspaceDir, taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const sections = [...draft.sections];
  while (sections.length <= hunk.sectionIndex) {
    sections.push({ heading: hunk.sectionHeading ?? "", body: "" });
  }
  const section = sections[hunk.sectionIndex];
  const isSurgical =
    hunk.granularity === "surgical" &&
    typeof hunk.spanStart === "number" &&
    typeof hunk.spanEnd === "number";

  if (isSurgical) {
    if (decision === "reject") {
      // Draft body already has the post-edit text; span indices are baseline-relative,
      // so prefer unique substring replace of `after` → `before`.
      const idx = section.body.indexOf(hunk.after);
      const newBody =
        idx >= 0
          ? section.body.slice(0, idx) + hunk.before + section.body.slice(idx + hunk.after.length)
          : applySpanToBody(
              section.body,
              {
                spanStart: hunk.spanStart!,
                spanEnd: hunk.spanEnd!,
                before: hunk.before,
                after: hunk.after,
              },
              "toBefore",
            );
      sections[hunk.sectionIndex] = {
        ...section,
        heading: hunk.sectionHeading ?? section.heading,
        body: newBody,
      };
    }
    // accept: draft already contains `after`; only advance baseline span below.
  } else {
    const body = decision === "accept" ? hunk.after : hunk.before;
    sections[hunk.sectionIndex] = {
      ...section,
      heading: hunk.sectionHeading ?? section.heading,
      body,
    };
  }

  draft = { ...draft, sections };

  if (decision === "accept") {
    const acceptedSection = sections[hunk.sectionIndex];
    if (acceptedSection) {
      sections[hunk.sectionIndex] = {
        ...acceptedSection,
        provenance: appendProvenanceEvent(
          acceptedSection.provenance,
          createProvenanceEvent("lawyer_accept", "user", {
            sourceId: hunk.hunkId,
            reason: hunk.rationale,
            diffSummary: diffSummary(hunk.before, hunk.after),
          }),
        ),
      };
      draft = { ...draft, sections };
    }
  }

  persistDraft(workspaceDir, draft);

  if (decision === "accept") {
    const baseline = [...proposal.baselineSections];
    while (baseline.length <= hunk.sectionIndex) {
      baseline.push({ heading: hunk.sectionHeading ?? "", body: "" });
    }
    if (isSurgical) {
      const baseBody = baseline[hunk.sectionIndex]?.body ?? "";
      baseline[hunk.sectionIndex] = {
        heading: hunk.sectionHeading ?? baseline[hunk.sectionIndex]?.heading ?? "",
        body: applySpanToBody(
          baseBody,
          {
            spanStart: hunk.spanStart!,
            spanEnd: hunk.spanEnd!,
            before: hunk.before,
            after: hunk.after,
          },
          "toAfter",
        ),
      };
    } else {
      baseline[hunk.sectionIndex] = { ...sections[hunk.sectionIndex] };
    }
    proposal.baselineSections = baseline;

    // 偏移修正：surgical span 是相对 accept 前 baseline 的偏移；本次 accept 改变了
    // 该段正文长度后，同段后续 pending hunk 的 span 必须按 delta 平移，否则下一次
    // applySpanToBody 会切错位置并回退到 indexOf（重复子串时改错处）。
    // splitSurgicalEditSpans 产出的 span 本来就不重叠且有序，平移后仍然精确命中。
    if (isSurgical) {
      const delta = hunk.after.length - hunk.before.length;
      if (delta !== 0) {
        for (const other of proposal.hunks) {
          if (
            other.hunkId !== hunk.hunkId &&
            other.status === "pending" &&
            other.granularity === "surgical" &&
            other.sectionIndex === hunk.sectionIndex &&
            typeof other.spanStart === "number" &&
            typeof other.spanEnd === "number" &&
            other.spanStart >= hunk.spanEnd!
          ) {
            other.spanStart += delta;
            other.spanEnd += delta;
          }
        }
      }
    }
  }

  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal, draft };
}

/**
 * Resolve every pending hunk with the same decision (Cursor-like Accept/Reject all).
 */
export function resolveAllRedlineHunks(
  workspaceDir: string,
  taskId: string,
  decision: "accept" | "reject",
):
  | { ok: true; proposal: RedlineProposal; draft?: ArtifactDraft; resolved: number }
  | { ok: false; error: string } {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  if (!proposal) {
    return { ok: false, error: "redline_not_found" };
  }
  const pendingIds = proposal.hunks.filter((h) => h.status === "pending").map((h) => h.hunkId);
  let lastDraft: ArtifactDraft | undefined;
  let resolved = 0;
  for (const id of pendingIds) {
    const r = resolveRedlineHunk(workspaceDir, taskId, id, decision);
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    lastDraft = r.draft;
    resolved++;
  }
  const next = readRedlineProposal(workspaceDir, taskId);
  if (!next) {
    return { ok: false, error: "redline_not_found" };
  }
  return { ok: true, proposal: next, draft: lastDraft, resolved };
}

const REVISE_AFTER_MAX = 50_000;

function replaceOnce(haystack: string, needle: string, replacement: string): string | undefined {
  if (!needle) {
    return undefined;
  }
  const idx = haystack.indexOf(needle);
  if (idx < 0) {
    return undefined;
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

/**
 * Replay minimal spans onto `before`, swapping one span's replacement.
 * Falls back to a unique substring swap when the pane shows a transformed anchor
 * (pure inserts are stored as "anchor → inserted+anchor", not the raw span).
 */
export function nextAfterForSpan(
  before: string,
  after: string,
  find: string,
  currentReplace: string,
  nextReplace: string,
): string | undefined {
  const spans = computeMinimalEditSpans(before, after);
  const target = spans.find((span) => span.before === find && span.after === currentReplace);
  if (target) {
    const ordered = spans.toSorted((a, b) => a.spanStart - b.spanStart);
    let cursor = 0;
    let out = "";
    for (const span of ordered) {
      if (span.spanStart < cursor) {
        continue;
      }
      out += before.slice(cursor, span.spanStart);
      const isTarget = span.spanStart === target.spanStart && span.spanEnd === target.spanEnd;
      out += isTarget ? nextReplace : span.after;
      cursor = span.spanEnd;
    }
    out += before.slice(cursor);
    return out;
  }
  if (!currentReplace) {
    return undefined;
  }
  const idx = after.indexOf(currentReplace);
  if (idx < 0 || after.indexOf(currentReplace, idx + currentReplace.length) >= 0) {
    return undefined;
  }
  return after.slice(0, idx) + nextReplace + after.slice(idx + currentReplace.length);
}

function replaceSectionText(body: string, from: string, to: string, surgical: boolean): string {
  if (!surgical || body === from) {
    return to;
  }
  return replaceOnce(body, from, to) ?? body;
}

/**
 * 已经接受或拒绝的条目改点另一边。草稿和 baseline 里落下去的那段文字跟着换，
 * 不把这条再锁死。
 */
function retargetResolvedHunkUnlocked(
  workspaceDir: string,
  proposal: RedlineProposal,
  hunk: RedlineHunk,
  decision: "accept" | "reject",
): { ok: true; proposal: RedlineProposal; draft?: ArtifactDraft } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, proposal.taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const from = hunk.status === "accepted" ? hunk.after : hunk.before;
  const to = decision === "accept" ? hunk.after : hunk.before;
  const surgical = hunk.granularity === "surgical";
  const sections = [...draft.sections];
  while (sections.length <= hunk.sectionIndex) {
    sections.push({ heading: hunk.sectionHeading ?? "", body: "" });
  }
  const section = sections[hunk.sectionIndex] ?? { heading: "", body: "" };
  sections[hunk.sectionIndex] = {
    ...section,
    heading: hunk.sectionHeading ?? section.heading,
    body: replaceSectionText(section.body, from, to, surgical),
  };
  const nextDraft = { ...draft, sections };
  persistDraft(workspaceDir, nextDraft);

  const baseline = [...proposal.baselineSections];
  while (baseline.length <= hunk.sectionIndex) {
    baseline.push({ heading: hunk.sectionHeading ?? "", body: "" });
  }
  const base = baseline[hunk.sectionIndex] ?? { heading: "", body: "" };
  baseline[hunk.sectionIndex] = {
    heading: hunk.sectionHeading ?? base.heading,
    body: replaceSectionText(base.body, from, to, surgical),
  };
  proposal.baselineSections = baseline;
  hunk.status = decision === "accept" ? "accepted" : "rejected";
  proposal.updatedAt = new Date().toISOString();
  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal, draft: nextDraft };
}

function applyPendingAfterUnlocked(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  after: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  const proposal = readRedlineProposal(workspaceDir, taskId);
  if (!proposal) {
    return { ok: false, error: "redline_not_found" };
  }
  const hunk = proposal.hunks.find((h) => h.hunkId === hunkId);
  if (!hunk) {
    return { ok: false, error: "hunk_not_found" };
  }
  if (hunk.after === after) {
    return { ok: true, proposal };
  }
  const previousAfter = hunk.after;
  hunk.after = after;
  proposal.updatedAt = new Date().toISOString();

  const draft = readDraft(workspaceDir, taskId);
  if (draft && hunk.status !== "rejected") {
    const sections = [...draft.sections];
    while (sections.length <= hunk.sectionIndex) {
      sections.push({ heading: hunk.sectionHeading ?? "", body: "" });
    }
    const section = sections[hunk.sectionIndex] ?? { heading: "", body: "" };
    sections[hunk.sectionIndex] = {
      ...section,
      heading: hunk.sectionHeading ?? section.heading,
      body: replaceSectionText(section.body, previousAfter, after, hunk.granularity === "surgical"),
    };
    persistDraft(workspaceDir, { ...draft, sections });
  }
  if (hunk.status === "accepted") {
    const baseline = [...proposal.baselineSections];
    while (baseline.length <= hunk.sectionIndex) {
      baseline.push({ heading: hunk.sectionHeading ?? "", body: "" });
    }
    const base = baseline[hunk.sectionIndex] ?? { heading: "", body: "" };
    baseline[hunk.sectionIndex] = {
      heading: hunk.sectionHeading ?? base.heading,
      body: replaceSectionText(base.body, previousAfter, after, hunk.granularity === "surgical"),
    };
    proposal.baselineSections = baseline;
  }

  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal };
}

/**
 * Lawyer rewrites a pending revision in the Word surface before accept/reject.
 * The proposal `after` is what export and the page render. The draft body is
 * updated when the previous `after` can be found, so a later accept stays aligned.
 */
export function revisePendingRedlineHunk(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  after: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  if (after.length > REVISE_AFTER_MAX) {
    return { ok: false, error: "after_too_long" };
  }
  return withExclusiveFileLock(redlineProposalLockPath(workspaceDir, taskId), () =>
    applyPendingAfterUnlocked(workspaceDir, taskId, hunkId, after),
  );
}

/**
 * Edit one suggestion the add-in is showing. Undoing the only change rejects the hunk
 * so the middle column and the next Word export drop it together.
 */
export function revisePendingRedlineSpan(
  workspaceDir: string,
  taskId: string,
  hunkId: string,
  find: string,
  currentReplace: string,
  nextReplace: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  if (nextReplace.length > REVISE_AFTER_MAX) {
    return { ok: false, error: "after_too_long" };
  }
  return withExclusiveFileLock(redlineProposalLockPath(workspaceDir, taskId), () => {
    const proposal = readRedlineProposal(workspaceDir, taskId);
    if (!proposal) {
      return { ok: false, error: "redline_not_found" };
    }
    const hunk = proposal.hunks.find((h) => h.hunkId === hunkId);
    if (!hunk) {
      return { ok: false, error: "hunk_not_found" };
    }
    if (hunk.status !== "pending") {
      return { ok: false, error: "hunk_not_pending" };
    }
    const rebuilt = nextAfterForSpan(hunk.before, hunk.after, find, currentReplace, nextReplace);
    if (rebuilt === undefined) {
      return { ok: false, error: "span_not_found" };
    }
    if (rebuilt === hunk.before) {
      const rejected = resolveRedlineHunkUnlocked(workspaceDir, taskId, hunkId, "reject");
      if (!rejected.ok) {
        return rejected;
      }
      return { ok: true, proposal: rejected.proposal };
    }
    return applyPendingAfterUnlocked(workspaceDir, taskId, hunkId, rebuilt);
  });
}

/**
 * Call **before** agent/lawyer overlay write: lock baseline from current draft when none exists.
 * Keeps an existing baseline (so pending proposals stay anchored).
 */
export function prepareRedlineBaselineBeforeWrite(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal; created: boolean } | { ok: false; error: string } {
  const existing = readRedlineProposal(workspaceDir, taskId);
  if (existing?.baselineSections?.length) {
    return { ok: true, proposal: existing, created: false };
  }
  const baselined = resetRedlineBaselineFromDraft(workspaceDir, taskId);
  if (!baselined.ok) {
    return baselined;
  }
  return { ok: true, proposal: baselined.proposal, created: true };
}

/**
 * Call **after** draft body write: regenerate section hunks vs baseline.
 */
export function generateRedlineAfterWrite(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  return generateRedlineProposal(workspaceDir, taskId);
}

export function resetRedlineBaselineFromDraft(
  workspaceDir: string,
  taskId: string,
): { ok: true; proposal: RedlineProposal } | { ok: false; error: string } {
  const draft = readDraft(workspaceDir, taskId);
  if (!draft) {
    return { ok: false, error: "draft_not_found" };
  }
  const proposal: RedlineProposal = {
    taskId,
    matterId: draft.matterId,
    baselineSections: draft.sections.map((s) => ({ ...s })),
    hunks: [],
    updatedAt: new Date().toISOString(),
  };
  writeRedlineProposal(workspaceDir, proposal);
  return { ok: true, proposal };
}

export function redlineMatchesDraft(proposal: RedlineProposal, draft: ArtifactDraft): boolean {
  return sectionsEqual(proposal.baselineSections, draft.sections);
}

/** Attach or update contract-edit baseline metadata on a draft (does not persist). */
export function withContractEditBaseline(
  draft: ArtifactDraft,
  baselineRelativePath: string,
  mode: "surgical" | "section" = "surgical",
  baselineRoot?: "workspace" | "project",
): ArtifactDraft {
  const rel = baselineRelativePath.trim().replace(/\\/g, "/");
  return {
    ...draft,
    contractEdit: {
      ...(draft.contractEdit ?? { baselineRelativePath: rel }),
      baselineRelativePath: rel,
      mode,
      ...(baselineRoot
        ? { baselineRoot }
        : draft.contractEdit?.baselineRoot
          ? { baselineRoot: draft.contractEdit.baselineRoot }
          : {}),
    },
  };
}
