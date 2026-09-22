/**
 * Auto-wire contract body edit baseline (uploaded .docx / .doc) onto ArtifactDraft.
 * Stamps contractEdit; optionally seeds paragraph sections from the baseline file.
 * Binary `.doc` is first-class — no conversion required.
 */

import fs from "node:fs";
import path from "node:path";
import {
  resolveWordBaselineAbs,
  type WordBaselineRoot,
} from "../artifacts/word-revision-delivery.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
import type { ArtifactDraft, ResearchBundle } from "../types.js";
import { appendProvenanceEvent, createProvenanceEvent } from "./provenance.js";
import { withContractEditBaseline } from "./redline-proposal.js";
import { buildContractBodySectionsFromText } from "./surgical-diff.js";

/** `.docx` or binary `.doc` (not `.docm`). */
const WORD_BASELINE_RE = /\.docx$/i;
const WORD_DOC_RE = /\.doc$/i;

function isWordBaselinePath(rel: string): boolean {
  return WORD_BASELINE_RE.test(rel) || WORD_DOC_RE.test(rel);
}

/** Normalize to workspace-relative posix path; reject absolute / escape attempts. */
export function normalizeWorkspaceRelativePath(
  workspaceDir: string,
  raw: string,
): string | undefined {
  const resolved = resolveWorkspaceRelativePath(workspaceDir, raw);
  if (!resolved.ok || !resolved.rel) {
    return undefined;
  }
  return resolved.rel;
}

/** Return relative path if file exists under workspace and is .docx or .doc. */
export function resolveExistingDocxRelativePath(
  workspaceDir: string,
  raw: string,
): string | undefined {
  const rel = normalizeWorkspaceRelativePath(workspaceDir, raw);
  if (!rel || !isWordBaselinePath(rel)) {
    return undefined;
  }
  const abs = path.resolve(workspaceDir, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return undefined;
  }
  return rel;
}

export type ResolvedContractBaseline = {
  rel: string;
  root: WordBaselineRoot;
};

/** Workspace first, then the lawyer's project folder (file-page pins). */
export function resolveExistingWordBaseline(params: {
  workspaceDir: string;
  projectDir?: string;
  raw: string;
  preferredRoot?: WordBaselineRoot;
  pins?: ComposeContextPin[];
}): ResolvedContractBaseline | undefined {
  const found = resolveWordBaselineAbs({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    raw: params.raw,
    preferredRoot: params.preferredRoot,
    pins: params.pins,
  });
  if (!found) {
    return undefined;
  }
  return { rel: found.rel, root: found.root };
}

/**
 * Pull likely workspace-relative Word baseline paths (.docx / .doc) from free text
 * (chat pins, clarification, instructions).
 */
export function extractDocxRelativePathsFromText(text: string): string[] {
  if (!text.trim()) {
    return [];
  }
  const found = new Set<string>();
  const patterns = [
    /`([^`\n]+\.docx?)`/gi,
    /\[(?:项目|工作区)[^\]]*\]\s*`([^`\n]+\.docx?)`/gi,
    // ASCII-ish segments (legacy)
    /(?:^|[\s("'])((?:[\w.-]+\/)+[\w.-]+\.docx?)/gi,
    // Known roots — allow Unicode folder/file names (e.g. cases/临时讨论/合同.doc)
    /(?:^|[\s("'])((?:uploads|cases|mail|workspace|contracts|files)\/[^\s"'`)，。；]+\.docx?)/gi,
    // Generic relative paths with Unicode letters/numbers in any segment
    /(?:^|[\s("'])((?:[\p{L}\p{N}._-]+\/)+[\p{L}\p{N}._-]+\.docx?)/giu,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const cand = (m[1] ?? "").trim().replace(/\\/g, "/");
      if (cand && isWordBaselinePath(cand)) {
        found.add(cand);
      }
    }
  }
  return [...found];
}

export function draftLooksLikeContractBody(
  draft: ArtifactDraft,
  instructionHint?: string,
): boolean {
  const dt = draft.deliverableType ?? "";
  if (dt.startsWith("contract.") && dt !== "contract.review") {
    return true;
  }
  if (draft.contractEdit) {
    return true;
  }
  const blob = [instructionHint, draft.title, draft.summary].filter(Boolean).join("\n");
  if (/修改合同|合同改稿|审阅痕迹|红线稿|apply_surgical_edits|render_tracked_draft/i.test(blob)) {
    return true;
  }
  return /合同|条款|改稿|redline|审阅修订|最小修改/i.test(blob);
}

export function draftLooksLikeContractOpinion(draft: ArtifactDraft): boolean {
  const dt = draft.deliverableType ?? "";
  if (dt === "contract.review") {
    return true;
  }
  return /审查意见|意见书/.test(draft.title ?? "");
}

/** True when sections are empty or look like thin placeholders safe to replace. */
export function shouldSeedSectionsFromBaseline(draft: ArtifactDraft): boolean {
  const sections = draft.sections ?? [];
  if (sections.length === 0) {
    return true;
  }
  const bodyChars = sections.reduce((n, s) => n + (s.body?.trim().length ?? 0), 0);
  if (bodyChars < 40) {
    return true;
  }
  // Single short "正文" shell often produced by keyword draft before body ingest.
  if (
    sections.length === 1 &&
    /^(正文|概述|摘要)$/.test((sections[0]?.heading ?? "").trim()) &&
    bodyChars < 200
  ) {
    return true;
  }
  return false;
}

export function collectContractBaselineCandidates(params: {
  draft: ArtifactDraft;
  instruction?: string;
  bundle?: ResearchBundle;
  extraPaths?: string[];
  pins?: ComposeContextPin[];
}): string[] {
  const out: string[] = [];
  const push = (v: string | undefined | null) => {
    const t = v?.trim();
    if (t) {
      out.push(t);
    }
  };
  push(params.draft.contractEdit?.baselineRelativePath);
  push(params.draft.contractRevisionCapture?.initialRelativePath);
  for (const p of params.extraPaths ?? []) {
    push(p);
  }
  for (const pin of params.pins ?? []) {
    if (pin.pinKind === "file" && pin.kind === "file" && isWordBaselinePath(pin.relPath)) {
      push(pin.relPath);
    }
  }
  for (const p of extractDocxRelativePathsFromText(params.instruction ?? "")) {
    push(p);
  }
  for (const p of extractDocxRelativePathsFromText(params.draft.summary ?? "")) {
    push(p);
  }
  for (const s of params.bundle?.sources ?? []) {
    if (s.kind === "contract" || s.kind === "workspace" || isWordBaselinePath(s.url ?? "")) {
      push(s.url);
    }
  }
  return out;
}

export function resolveFirstExistingDocxBaseline(
  workspaceDir: string,
  candidates: string[],
  projectDir?: string,
): string | undefined {
  return resolveFirstExistingWordBaseline({ workspaceDir, projectDir, candidates })?.rel;
}

export function resolveFirstExistingWordBaseline(params: {
  workspaceDir: string;
  projectDir?: string;
  candidates: string[];
  preferredRoot?: WordBaselineRoot;
  pins?: ComposeContextPin[];
}): ResolvedContractBaseline | undefined {
  for (const c of params.candidates) {
    const found = resolveExistingWordBaseline({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: c,
      preferredRoot: params.preferredRoot ?? inferPreferredRootFromText(c),
      pins: params.pins,
    });
    if (found) {
      return found;
    }
  }
  return undefined;
}

function inferPreferredRootFromText(raw: string): WordBaselineRoot | undefined {
  if (/\[项目/.test(raw) || /^project:/i.test(raw)) {
    return "project";
  }
  if (/\[工作区/.test(raw) || /^(?:uploads|cases|mail|workspace|contracts)\//.test(raw)) {
    return "workspace";
  }
  return undefined;
}

/** Stamp contractEdit when a candidate .docx exists; does not read file contents (sync-safe). */
export function stampContractEditBaselineIfNeeded(params: {
  workspaceDir: string;
  projectDir?: string;
  draft: ArtifactDraft;
  instruction?: string;
  bundle?: ResearchBundle;
  extraPaths?: string[];
  mode?: "surgical" | "section";
  pins?: ComposeContextPin[];
}): ArtifactDraft {
  const { draft } = params;
  const preferredRoot = draft.contractEdit?.baselineRoot;
  if (draft.contractEdit?.baselineRelativePath?.trim()) {
    const existing = resolveExistingWordBaseline({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      raw: draft.contractEdit.baselineRelativePath,
      preferredRoot,
      pins: params.pins,
    });
    if (existing) {
      return withContractEditBaseline(
        draft,
        existing.rel,
        draft.contractEdit.mode ?? params.mode ?? "surgical",
        existing.root,
      );
    }
  }
  const looksContract =
    draftLooksLikeContractBody(draft, params.instruction) ||
    draftLooksLikeContractOpinion(draft) ||
    (draft.deliverableType ?? "").startsWith("contract.");
  if (!looksContract) {
    return draft;
  }
  const found = resolveFirstExistingWordBaseline({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    candidates: collectContractBaselineCandidates(params),
    preferredRoot: /\[项目/.test(params.instruction ?? "") ? "project" : preferredRoot,
    pins: params.pins,
  });
  if (!found) {
    return draft;
  }
  return withContractEditBaseline(draft, found.rel, params.mode ?? "surgical", found.root);
}

export type ContractBaselineSeedResult = {
  draft: ArtifactDraft;
  /** Set when seeding was attempted but body could not be read/applied. */
  warning?: string;
};

export type ContractEditEnrichResult = {
  draft: ArtifactDraft;
  warnings: string[];
};

/** Read baseline Word text and replace sections with paragraph units (async). */
export async function seedDraftSectionsFromContractBaseline(params: {
  workspaceDir: string;
  projectDir?: string;
  draft: ArtifactDraft;
  /** Force seed even when sections look substantial. */
  force?: boolean;
  pins?: ComposeContextPin[];
}): Promise<ContractBaselineSeedResult> {
  const rel = params.draft.contractEdit?.baselineRelativePath?.trim();
  if (!rel) {
    return { draft: params.draft };
  }
  if (draftLooksLikeContractOpinion(params.draft) && !params.force) {
    return { draft: params.draft };
  }
  if (!params.force && !shouldSeedSectionsFromBaseline(params.draft)) {
    return { draft: params.draft };
  }
  const resolved = resolveWordBaselineAbs({
    workspaceDir: params.workspaceDir,
    projectDir: params.projectDir,
    raw: rel,
    preferredRoot: params.draft.contractEdit?.baselineRoot,
    pins: params.pins,
  });
  const abs = resolved?.abs ?? path.resolve(params.workspaceDir, rel);
  if (!fs.existsSync(abs)) {
    return {
      draft: params.draft,
      warning: `合同基线文件不存在，未能填入正文段落：${rel}`,
    };
  }
  try {
    let text = "";
    if (WORD_DOC_RE.test(rel) && !WORD_BASELINE_RE.test(rel)) {
      const { readBinaryWordDocText } = await import("../mail/read-word-binary.js");
      text = await readBinaryWordDocText(abs);
    } else {
      const { readDocxText } = await import("../agent/tools/legal/ingest-helpers.js");
      text = await readDocxText(abs);
    }
    if (!text.trim()) {
      return {
        draft: params.draft,
        warning: `合同基线无可读正文，未能填入段落（请确认文件未损坏）：${rel}`,
      };
    }
    const sections = buildContractBodySectionsFromText(text);
    if (sections.length === 0) {
      return {
        draft: params.draft,
        warning: `合同基线未能切出可用段落：${rel}`,
      };
    }
    const sourceName = path.basename(rel).replace(/\.docx?$/i, "");
    const seededSections = sections.map((section) => ({
      ...section,
      provenance: appendProvenanceEvent(
        undefined,
        createProvenanceEvent("upload", "system", {
          sourceId: rel,
          comment: sourceName,
        }),
      ),
    }));
    return { draft: { ...params.draft, sections: seededSections } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      draft: params.draft,
      warning: `读取合同基线失败，正文未自动填入：${rel}（${msg.slice(0, 160)}）`,
    };
  }
}

/**
 * Full enrich: stamp baseline from hints, optionally seed paragraph sections from Word.
 * Returns warnings when seed was attempted but failed (never silent on forced/thin-body seed).
 */
export async function enrichDraftWithContractEditBaseline(params: {
  workspaceDir: string;
  projectDir?: string;
  draft: ArtifactDraft;
  instruction?: string;
  bundle?: ResearchBundle;
  extraPaths?: string[];
  mode?: "surgical" | "section";
  seedSections?: boolean;
  pins?: ComposeContextPin[];
}): Promise<ContractEditEnrichResult> {
  const warnings: string[] = [];
  let next = stampContractEditBaselineIfNeeded(params);
  if (params.seedSections !== false) {
    const seeded = await seedDraftSectionsFromContractBaseline({
      workspaceDir: params.workspaceDir,
      projectDir: params.projectDir,
      draft: next,
      force: params.seedSections === true,
      pins: params.pins,
    });
    next = seeded.draft;
    if (seeded.warning) {
      warnings.push(seeded.warning);
    }
  }
  return { draft: next, warnings };
}
