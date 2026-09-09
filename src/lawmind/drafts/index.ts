/**
 * Draft snapshot persistence.
 *
 * 目的：
 * - 让草稿在会话结束后仍可继续审核/渲染
 * - 为后续 UI 审核台提供稳定数据源
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import type { ArtifactDraft } from "../types.js";

function draftsDir(workspaceDir: string): string {
  return path.join(workspaceDir, "drafts");
}

export function draftPath(workspaceDir: string, taskId: string): string {
  return path.join(draftsDir(workspaceDir), `${taskId}.json`);
}

export function persistDraft(workspaceDir: string, draft: ArtifactDraft): string {
  const target = draftPath(workspaceDir, draft.taskId);
  writeJsonAtomic(target, draft);
  return target;
}

export function readDraft(workspaceDir: string, taskId: string): ArtifactDraft | undefined {
  try {
    const content = fs.readFileSync(draftPath(workspaceDir, taskId), "utf8");
    return JSON.parse(content) as ArtifactDraft;
  } catch {
    return undefined;
  }
}

/** Remove draft JSON and common sidecars (research / reasoning / redline). */
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
    path.join(dir, `${id}.clauses.json`),
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
  return did;
}

export function listDrafts(workspaceDir: string): ArtifactDraft[] {
  try {
    const dir = draftsDir(workspaceDir);
    const files = fs
      .readdirSync(dir)
      .filter(
        (name) =>
          name.endsWith(".json") &&
          !name.endsWith(".research.json") &&
          !name.endsWith(".reasoning.json") &&
          !name.endsWith(".redline.json") &&
          !name.endsWith(".clauses.json") &&
          !name.endsWith(".outline.json"),
      )
      .toSorted();
    return files
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
