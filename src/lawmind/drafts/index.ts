/**
 * Draft snapshot persistence.
 *
 * 目的：
 * - 让草稿在会话结束后仍可继续审核/渲染
 * - 为后续 UI 审核台提供稳定数据源
 */

import fs from "node:fs";
import path from "node:path";
import type { ArtifactDraft, ReviewStatus } from "../types.js";
import { commitDraft, completionSidecarPath, type DraftFileProvenance } from "./commit-draft.js";
import {
  draftListCacheGen,
  invalidateDraftListCache,
  readDraftListCache,
  writeDraftListCache,
} from "./list-cache.js";

function draftsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "drafts");
}

export function draftPath(workspaceDir: string, taskId: string): string {
  return path.join(draftsDir(workspaceDir), `${taskId}.json`);
}

export { invalidateDraftListCache } from "./list-cache.js";

export function persistDraft(workspaceDir: string, draft: ArtifactDraft): string {
  const provenance: DraftFileProvenance = { channel: "file" };
  return commitDraft(workspaceDir, draft, provenance);
}

export {
  commitDraft,
  completionSidecarPath,
  deriveDeliverableCompletion,
  type DeliverableCompletion,
  type DeliverableCompletionRecord,
  type DraftCommitProvenance,
  type DraftFileProvenance,
  type DraftPipelineProvenance,
} from "./commit-draft.js";
export { citationViewBlocksExport, evaluateMechanicalVerdict } from "./mechanical-verdict.js";
export type {
  MechanicalBlock,
  MechanicalSignals,
  MechanicalVerdict,
} from "./mechanical-verdict.js";

export function readDraft(workspaceDir: string, taskId: string): ArtifactDraft | undefined {
  try {
    const content = fs.readFileSync(draftPath(workspaceDir, taskId), "utf8");
    return JSON.parse(content) as ArtifactDraft;
  } catch {
    return undefined;
  }
}

/**
 * Remove the draft JSON and every sidecar `listDrafts` ignores, plus the redline lock.
 * Leaving `.redline-plan.json` would let the next empty `apply_surgical_edits` replay a deleted plan.
 */
export function deleteDraft(workspaceDir: string, taskId: string): boolean {
  const id = taskId.trim();
  if (!id) {
    return false;
  }
  const dir = draftsDir(workspaceDir);
  const candidates = [
    draftPath(workspaceDir, id),
    path.join(dir, `${id}.research.json`),
    path.join(dir, `${id}.reasoning.json`),
    path.join(dir, `${id}.redline.json`),
    path.join(dir, `${id}.redline.json.lock`),
    path.join(dir, `${id}.redline-plan.json`),
    path.join(dir, `${id}.clauses.json`),
    path.join(dir, `${id}.guardian.json`),
    path.join(dir, `${id}.outline.json`),
    path.join(dir, `${id}.review-head.json`),
    completionSidecarPath(workspaceDir, id),
  ];
  let did = false;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        did = true;
      }
    } catch {
      /* best-effort */
    }
  }
  if (did) {
    invalidateDraftListCache(workspaceDir);
  }
  return did;
}

function isDraftSnapshotName(name: string): boolean {
  return (
    name.endsWith(".json") &&
    !name.endsWith(".research.json") &&
    !name.endsWith(".reasoning.json") &&
    !name.endsWith(".redline.json") &&
    !name.endsWith(".clauses.json") &&
    !name.endsWith(".outline.json") &&
    !name.endsWith(".guardian.json") &&
    !name.endsWith(".completion.json") &&
    !name.endsWith(".redline-plan.json") &&
    !name.endsWith(".review-head.json")
  );
}

export type DraftReviewHead = {
  taskId: string;
  matterId?: string;
  title: string;
  reviewStatus: ReviewStatus;
  createdAt: string;
  reviewedAt?: string;
};

function draftReviewHeadFromRaw(raw: string): DraftReviewHead | null {
  try {
    const draft = JSON.parse(raw) as Partial<ArtifactDraft>;
    if (!draft.taskId || !draft.reviewStatus || !draft.title || !draft.createdAt) {
      return null;
    }
    return {
      taskId: draft.taskId,
      matterId: draft.matterId,
      title: draft.title,
      reviewStatus: draft.reviewStatus,
      createdAt: draft.createdAt,
      reviewedAt: draft.reviewedAt,
    };
  } catch {
    return null;
  }
}

function reviewHeadPath(dir: string, taskId: string): string {
  return path.join(dir, `${taskId}.review-head.json`);
}

function readReviewHeadFile(filePath: string): DraftReviewHead | null {
  try {
    return draftReviewHeadFromRaw(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** 在办待签批列表用。优先读 commit 时写下的小索引，索引比文稿旧才读全文。 */
export function listDraftReviewHeads(workspaceDir: string): DraftReviewHead[] {
  try {
    const dir = draftsDir(workspaceDir);
    const names = fs.readdirSync(dir);
    const headNames = new Set(names.filter((name) => name.endsWith(".review-head.json")));
    const heads = new Map<string, DraftReviewHead>();
    for (const name of names) {
      if (!name.endsWith(".review-head.json")) {
        continue;
      }
      const head = readReviewHeadFile(path.join(dir, name));
      if (head) {
        heads.set(head.taskId, head);
      }
    }
    for (const name of names.filter(isDraftSnapshotName)) {
      const taskId = name.slice(0, -".json".length);
      if (headNames.has(`${taskId}.review-head.json`) && heads.has(taskId)) {
        continue;
      }
      const snapPath = path.join(dir, name);
      const headPath = reviewHeadPath(dir, taskId);
      try {
        const head = draftReviewHeadFromRaw(fs.readFileSync(snapPath, "utf8"));
        if (!head) {
          continue;
        }
        try {
          fs.writeFileSync(headPath, JSON.stringify(head), "utf8");
        } catch {
          /* 下次再补 */
        }
        heads.set(taskId, head);
      } catch {
        /* 坏文件跳过 */
      }
    }
    return [...heads.values()].toSorted((a, b) =>
      (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );
  } catch {
    return [];
  }
}

export function listDrafts(workspaceDir: string): ArtifactDraft[] {
  const cached = readDraftListCache(workspaceDir);
  if (cached) {
    return cached.drafts;
  }
  const genAtScanStart = draftListCacheGen(workspaceDir);
  try {
    const dir = draftsDir(workspaceDir);
    const files = fs.readdirSync(dir).filter(isDraftSnapshotName).toSorted();
    const drafts = files
      .map((name) => {
        try {
          const content = fs.readFileSync(path.join(dir, name), "utf8");
          return JSON.parse(content) as ArtifactDraft;
        } catch {
          return undefined;
        }
      })
      .filter((draft): draft is ArtifactDraft => Boolean(draft))
      .toSorted((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    writeDraftListCache(workspaceDir, drafts, genAtScanStart);
    return drafts;
  } catch {
    return [];
  }
}

export {
  validateDraftCitationsAgainstBundle,
  type CitationIntegrityResult,
  type DraftCitationIntegrityView,
} from "./citation-integrity.js";
export {
  persistResearchSnapshot,
  readResearchSnapshot,
  researchSnapshotPath,
} from "./research-snapshot.js";
export {
  isLegalReasoningGraph,
  persistReasoningSnapshot,
  readReasoningSnapshot,
  reasoningSnapshotPath,
} from "./reasoning-snapshot.js";
export { resolveDraftCitationIntegrity } from "./citation-resolve.js";
export {
  generateRedlineAfterWrite,
  generateRedlineProposal,
  prepareRedlineBaselineBeforeWrite,
  readRedlineProposal,
  resetRedlineBaselineFromDraft,
  resolveAllRedlineHunks,
  resolveRedlineHunk,
  summarizeRedline,
  writeRedlineProposal,
  withContractEditBaseline,
  redlineProposalPath,
  type RedlineProposal,
  type RedlineHunk,
  type RedlineHunkStatus,
} from "./redline-proposal.js";
export {
  buildContractBodySectionsFromText,
  extractMinimalEditSpan,
  formatOfficeCliFindArg,
  splitSurgicalEditSpans,
  toTrackedFindReplace,
} from "./surgical-diff.js";
export {
  SURGICAL_CONTRACT_EDIT_PROMPT,
  evaluateSurgicalEditGate,
  attachRewriteAmplitudeMeta,
} from "./surgical-edit-gate.js";
export {
  LEGACY_UPDATE_DRAFT_BODY_CODE,
  LEGACY_UPDATE_DRAFT_BODY_WARNING,
  shouldRejectLegacyUpdateDraftBody,
} from "./legacy-update-draft-warning.js";
export {
  CONTRACT_REDLINE_CRAFT_SKILL,
  craftSignalsForEdit,
  evaluateCraftCheck,
  parseCraftCheckInput,
} from "./contract-redline-craft.js";
export {
  explainSurgicalSpanViolation,
  SURGICAL_MAX_FIND_CHARS,
  SURGICAL_MAX_FIND_WITH_TERMINATOR,
} from "./surgical-span-gate.js";
export { applySurgicalTextEdits, parseSurgicalEditsInput } from "./apply-surgical-edits.js";
export {
  collectContractBaselineCandidates,
  draftLooksLikeContractBody,
  enrichDraftWithContractEditBaseline,
  extractDocxRelativePathsFromText,
  resolveExistingDocxRelativePath,
  seedDraftSectionsFromContractBaseline,
  stampContractEditBaselineIfNeeded,
  shouldSeedSectionsFromBaseline,
} from "./contract-edit-baseline.js";
export type {
  ContractBaselineSeedResult,
  ContractEditEnrichResult,
} from "./contract-edit-baseline.js";
export {
  clauseSnapshotPath,
  persistClauseSnapshot,
  readClauseSnapshot,
  resolveClauseGraphForDraft,
} from "./clause-snapshot.js";
export {
  appendProvenanceEvent,
  createProvenanceEvent,
  diffSummary,
  findLatestProvenanceEvent,
  findProvenanceBySource,
  isAiGeneratedProvenance,
  isUserModifiedProvenance,
  renderProvenanceAsFootnote,
  type ProvenanceActor,
  type ProvenanceChain,
  type ProvenanceEvent,
  type ProvenanceEventType,
} from "./provenance.js";
