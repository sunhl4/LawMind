/**
 * 从 ResearchBundle + 草稿 citations 收集 MeWork 形证据锚，交给 validateFileReferences。
 * 仅在「路径 + 内容指纹 + 可解析 lineRef + quote」齐全时入闸；否则留给既有 evidence-support。
 */

import type { ArtifactDraft, ResearchBundle, ResearchClaim, ResearchSource } from "../types.js";
import {
  contentSha256FromFileVersion,
  validateFileReferences,
  validateFileReferencesAsync,
  type FileReference,
  type FileReferenceSource,
  type ValidateFileReferencesResult,
} from "./evidence-anchor.js";
import { parseEvidenceLocator, splitPathAndLocator } from "./evidence-locator.js";

function citedSourceIds(draft: ArtifactDraft): Set<string> {
  const cited = new Set<string>();
  for (const section of draft.sections) {
    for (const id of section.citations ?? []) {
      const trimmed = id.trim();
      if (trimmed) {
        cited.add(trimmed);
      }
    }
  }
  return cited;
}

/** pin.page / url hash → MeWork-style lineRef, or null if unknown. */
export function lineRefFromPinAndUrl(input: { url?: string; page?: string }): string | null {
  const fromUrl = splitPathAndLocator(input.url ?? "").locator;
  if (fromUrl && parseEvidenceLocator(fromUrl)) {
    return fromUrl;
  }
  const page = (input.page ?? "").trim();
  if (!page) {
    return null;
  }
  if (parseEvidenceLocator(page)) {
    return page;
  }
  const asPage = /^P?([1-9]\d*)$/i.exec(page);
  if (asPage) {
    return `P${asPage[1]}`;
  }
  const zhPage = /第\s*([0-9]+)\s*页/.exec(page);
  if (zhPage) {
    return `P${Number(zhPage[1])}`;
  }
  return null;
}

function workspaceRelPath(source: ResearchSource): string | null {
  const raw = (source.url ?? "").trim();
  if (!raw || /^https?:\/\//i.test(raw)) {
    return null;
  }
  const { path: rel } = splitPathAndLocator(raw);
  return rel || null;
}

export type CollectedFileReferences = {
  sourceFiles: FileReferenceSource[];
  references: FileReference[];
};

/**
 * 纯收集：不读盘。缺 fingerprint / lineRef / quote 的条目直接跳过。
 */
export function collectFileReferencesFromDraftBundle(input: {
  draft: ArtifactDraft;
  bundle: ResearchBundle;
}): CollectedFileReferences | null {
  const cited = citedSourceIds(input.draft);
  if (cited.size === 0) {
    return null;
  }

  const byId = new Map(input.bundle.sources.map((s) => [s.id, s]));
  const sourceFiles: FileReferenceSource[] = [];
  const seenPaths = new Set<string>();
  const references: FileReference[] = [];
  let refSeq = 0;

  for (const sourceId of cited) {
    const source = byId.get(sourceId);
    if (!source) {
      continue;
    }
    const rel = workspaceRelPath(source);
    if (!rel) {
      continue;
    }
    const sha = contentSha256FromFileVersion(source.sourceVersion);
    if (!sha) {
      continue;
    }
    if (!seenPaths.has(rel)) {
      seenPaths.add(rel);
      sourceFiles.push({ path: rel, contentSha256: sha });
    }

    const claims: ResearchClaim[] = input.bundle.claims.filter((c) =>
      c.sourceIds.includes(sourceId),
    );
    const candidates =
      claims.length > 0
        ? claims
        : source.excerpt
          ? [
              {
                text: source.excerpt,
                sourceIds: [sourceId],
                confidence: 1,
                model: "legal" as const,
                pin: { quote: source.excerpt },
              },
            ]
          : [];

    for (const claim of candidates) {
      const quote = (claim.pin?.quote ?? "").trim();
      if (!quote) {
        continue;
      }
      const lineRef = lineRefFromPinAndUrl({
        url: source.url,
        page: claim.pin?.page,
      });
      if (!lineRef) {
        continue;
      }
      refSeq += 1;
      references.push({
        id: `${sourceId}:${refSeq}`,
        filePath: rel,
        lineRef,
        text: quote,
      });
    }
  }

  if (sourceFiles.length === 0 || references.length === 0) {
    return null;
  }
  return { sourceFiles, references };
}

/** 有结构化锚时跑闸门；否则返回 null（调用方不挡 file_references）。 */
export function validateDraftFileReferences(input: {
  rootDir: string;
  draft: ArtifactDraft;
  bundle: ResearchBundle;
}): ValidateFileReferencesResult | null {
  const collected = collectFileReferencesFromDraftBundle(input);
  if (!collected) {
    return null;
  }
  return validateFileReferences({
    rootDir: input.rootDir,
    sourceFiles: collected.sourceFiles,
    references: collected.references,
  });
}

/** 异步版：PDF 页锚 / Excel 单元格锚会真正读取原文核对。 */
export async function validateDraftFileReferencesAsync(input: {
  rootDir: string;
  draft: ArtifactDraft;
  bundle: ResearchBundle;
}): Promise<ValidateFileReferencesResult | null> {
  const collected = collectFileReferencesFromDraftBundle(input);
  if (!collected) {
    return null;
  }
  return validateFileReferencesAsync({
    rootDir: input.rootDir,
    sourceFiles: collected.sourceFiles,
    references: collected.references,
  });
}
