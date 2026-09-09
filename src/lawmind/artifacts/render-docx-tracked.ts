/**
 * Export Word with tracked changes via officecli (host dependency).
 * Prefers an uploaded contract baseline `.docx` or binary `.doc` when
 * `draft.contractEdit` is set. Binary `.doc` is first-class: an ephemeral
 * working copy may be used only for OpenXML edits (never requires the lawyer
 * to convert, and never writes a sibling `.docx` next to the original).
 *
 * Tracked changes use modern officecli:
 *   `set <file> /body --find … --replace … --prop revision.author=…`
 * Regex finds use the official `r"..."` prefix on --find (not a separate prop).
 * (the legacy `docx apply-redlines` subcommand is not available on current CLIs).
 */

import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { appendProvenanceEvent, createProvenanceEvent } from "../drafts/provenance.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import { readRedlineProposal } from "../drafts/redline-proposal.js";
import {
  disambiguateLiteralFind,
  formatOfficeCliFindArg,
  toTrackedFindReplace,
} from "../drafts/surgical-diff.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
import type { ArtifactDraft } from "../types.js";
import { renderDocxWithOptions } from "./render-docx.js";
import { resolveWordBaselineAbs } from "./word-revision-delivery.js";

export { formatOfficeCliFindArg } from "../drafts/surgical-diff.js";

export type TrackedDocxRenderResult =
  | {
      ok: true;
      outputPath: string;
      mode: "officecli" | "plain_fallback";
      baselineSource: "contract_file" | "rendered_draft";
      /**
       * True when proposals were requested but officecli could not apply tracked changes
       * (durable plain / draft-body copy only), or when .doc→docx conversion was lossy
       * (textutil stripped original revisions/fonts). Callers must surface this.
       */
      degraded?: boolean;
      /** Number of redline hunks successfully applied via officecli find/replace. */
      appliedHunks?: number;
      /** Converter used for binary .doc baselines (msword preserves revisions/fonts). */
      conversionTool?: string;
      /** high = Word/LibreOffice/native docx; lossy = textutil shell. */
      conversionFidelity?: "high" | "lossy";
      warning?: string;
    }
  | { ok: false; error: string; code: string };

function runOfficeCli(
  args: string[],
  timeoutMs = 120_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("officecli", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("officecli_timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function resolveContractBaselineAbsPath(
  workspaceDir: string | undefined,
  draft: ArtifactDraft,
  projectDir?: string,
  pins?: ComposeContextPin[],
): string | undefined {
  const rel = draft.contractEdit?.baselineRelativePath?.trim();
  if (!rel || !workspaceDir) {
    return undefined;
  }
  const found = resolveWordBaselineAbs({
    workspaceDir,
    projectDir,
    raw: rel,
    preferredRoot: draft.contractEdit?.baselineRoot,
    pins,
  });
  if (found) {
    return found.abs;
  }
  const resolved = resolveWorkspaceRelativePath(workspaceDir, rel);
  if (!resolved.ok) {
    return undefined;
  }
  const abs = resolved.abs;
  if (!/\.docx$/i.test(abs) && !/\.doc$/i.test(abs)) {
    return undefined;
  }
  if (!fsSync.existsSync(abs)) {
    return undefined;
  }
  return abs;
}

async function ephemeralDocxWorkingCopy(absDocPath: string): Promise<{
  docxPath: string;
  workDir: string;
  conversionTool?: string;
  conversionFidelity?: "high" | "lossy";
}> {
  const { ensureDocxForAttachment, tryReadHighFidelityDocxCache, writeHighFidelityDocxCache } =
    await import("../mail/convert-to-docx.js");
  const os = await import("node:os");
  // Temp workspace only — never write a converted sibling next to the lawyer's original .doc.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lm-doc-work-"));
  const leaf = path.basename(absDocPath);
  const tmpIn = path.join(tmpRoot, leaf);
  await fs.copyFile(absDocPath, tmpIn);

  // Fast path: reuse prior Microsoft Word / LibreOffice conversion for this .doc fingerprint.
  const cached = tryReadHighFidelityDocxCache(absDocPath);
  if (cached) {
    const outName = leaf.replace(/\.doc$/i, ".docx");
    const outAbs = path.join(tmpRoot, outName);
    await fs.copyFile(cached.docxPath, outAbs);
    return {
      docxPath: outAbs,
      workDir: tmpRoot,
      conversionTool: cached.tool,
      conversionFidelity: "high",
    };
  }

  const converted = await ensureDocxForAttachment(tmpRoot, leaf);
  if (!converted.ok) {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw new Error(converted.error);
  }
  const docxPath = path.join(tmpRoot, converted.relativePath);
  if (converted.fidelity === "high" && converted.tool && converted.tool !== "existing") {
    writeHighFidelityDocxCache(absDocPath, docxPath, converted.tool);
  }
  return {
    docxPath,
    workDir: tmpRoot,
    conversionTool: converted.tool,
    conversionFidelity: converted.fidelity,
  };
}

function actionableHunks(proposals: RedlineHunk[]): RedlineHunk[] {
  return proposals.filter(
    (h) =>
      h.status !== "rejected" &&
      typeof h.before === "string" &&
      typeof h.after === "string" &&
      h.before !== h.after &&
      // Deletion (after empty) or insertion (before empty) still need officecli apply.
      (h.before.trim().length > 0 || h.after.trim().length > 0),
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let n = 0;
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) {
      break;
    }
    n += 1;
    from = idx + Math.max(1, needle.length);
  }
  return n;
}

function countInBodies(bodies: string[] | undefined, needle: string): number {
  if (!bodies?.length || !needle) {
    return 0;
  }
  return bodies.reduce((n, b) => n + countOccurrences(b ?? "", needle), 0);
}

function countRegexInBodies(bodies: string[] | undefined, pattern: string): number {
  if (!bodies?.length || !pattern) {
    return -1;
  }
  try {
    const re = new RegExp(pattern, "g");
    let n = 0;
    for (const b of bodies) {
      const m = (b ?? "").match(re);
      n += m?.length ?? 0;
    }
    return n;
  } catch {
    return -1;
  }
}

/**
 * officecli find/replace needs a non-empty `--find`. Minimize del/ins markup via
 * character-level span + regex lookbehind for pure inserts (keep shared prefix unmarked).
 */
export function resolveOfficeCliFindReplace(
  hunk: RedlineHunk,
  sectionBodyAfter?: string,
): { find: string; replace: string; regex?: boolean } | null {
  const before = hunk.before ?? "";
  const after = hunk.after ?? "";
  if (before === after) {
    return null;
  }
  const tracked = toTrackedFindReplace({ before, after, bodyAfter: sectionBodyAfter });
  if (tracked) {
    return tracked;
  }
  // Legacy pad expand — last resort when lookbehind uniqueness fails.
  if (before.trim().length > 0) {
    return { find: before, replace: after };
  }
  const body = sectionBodyAfter ?? "";
  if (!after || !body.includes(after)) {
    return null;
  }
  const idx = body.indexOf(after);
  const pad = 16;
  const start = Math.max(0, idx - pad);
  const end = Math.min(body.length, idx + after.length + pad);
  const replace = body.slice(start, end);
  const find = replace.slice(0, idx - start) + replace.slice(idx - start + after.length);
  if (!find.trim() || find === replace) {
    return null;
  }
  return { find, replace };
}

/**
 * Apply surgical / section redlines onto a working .docx via officecli revision props.
 * Prefers matched === 1. Skips finds that appear more than once in baseline bodies
 * (ambiguous_match) so Word never silently rewrites every occurrence.
 */
export async function applyRedlineHunksWithOfficeCli(params: {
  workingDocxPath: string;
  proposals: RedlineHunk[];
  author?: string;
  /** Post-edit draft section bodies — used to expand insert-only surgical spans. */
  sectionBodiesAfter?: string[];
  /** Pre-edit / baseline section bodies — uniqueness checks before mutating. */
  sectionBodiesBefore?: string[];
}): Promise<{
  applied: number;
  attempted: number;
  ambiguous: number;
  /** matched>1 被回滚跳过的 hunk——调用方须写入 manifest 并明示 partial。 */
  ambiguousHunkIds: string[];
  /** 多处命中且回滚失败：交付副本不可信，调用方不得交付。 */
  rollbackFailed?: boolean;
  lastError?: string;
}> {
  const hunks = actionableHunks(params.proposals);
  if (hunks.length === 0) {
    return { applied: 0, attempted: 0, ambiguous: 0, ambiguousHunkIds: [] };
  }
  // Project / Finder Word files are often copied as read-only; officecli cannot
  // persist w:ins/w:del onto a 0444 working copy (io_error → 0 applied).
  try {
    await fs.chmod(params.workingDocxPath, 0o644);
  } catch {
    /* ignore — some hosts ignore mode */
  }
  const author = (params.author ?? "LawMind").trim() || "LawMind";
  const uniquenessBodies = params.sectionBodiesBefore?.length
    ? params.sectionBodiesBefore
    : params.sectionBodiesAfter;
  let applied = 0;
  let ambiguous = 0;
  let rollbackFailed = false;
  const ambiguousHunkIds: string[] = [];
  let lastError: string | undefined;
  // 每个 hunk 落盘前先备份工作副本：officecli 报 matched>1 时整体回滚，
  // 歧义 hunk 绝不多处落盘（与 surgical-span-gate 的「不确定就不改」语义一致）。
  const backupPath = `${params.workingDocxPath}.lm-bak`;
  try {
    for (const h of hunks) {
      const bodyAfter =
        typeof h.sectionIndex === "number"
          ? params.sectionBodiesAfter?.[h.sectionIndex]
          : undefined;
      const sectionBodyBefore =
        typeof h.sectionIndex === "number" ? uniquenessBodies?.[h.sectionIndex] : undefined;
      let fr = resolveOfficeCliFindReplace(h, bodyAfter);
      if (!fr) {
        lastError = `unresolvable_hunk:${(h.before || h.after).slice(0, 40)}`;
        continue;
      }
      if (fr.regex) {
        const n = countRegexInBodies(uniquenessBodies, fr.find);
        if (n > 1) {
          ambiguous += 1;
          ambiguousHunkIds.push(h.hunkId);
          lastError = `ambiguous_match:${fr.find.slice(0, 40)}`;
          continue;
        }
      } else if (countInBodies(uniquenessBodies, fr.find) > 1) {
        const pinned = disambiguateLiteralFind({
          find: fr.find,
          replace: fr.replace,
          sectionBody: sectionBodyBefore ?? "",
          spanStart: h.spanStart,
          uniquenessBodies: uniquenessBodies ?? [],
        });
        if (!pinned) {
          ambiguous += 1;
          ambiguousHunkIds.push(h.hunkId);
          lastError = `ambiguous_match:${fr.find.slice(0, 40)}`;
          continue;
        }
        fr = pinned;
      }
      // 备份失败不阻塞正常单处替换（与既有无备份行为一致）；但一旦 matched>1
      // 且无备份可回滚，只能整稿废弃（rollbackFailed），绝不让多处替换稿流出。
      let backedUp = false;
      try {
        await fs.copyFile(params.workingDocxPath, backupPath);
        backedUp = true;
      } catch {
        /* no safety net */
      }
      try {
        const findArg = formatOfficeCliFindArg(fr.find, fr.regex);
        const result = await runOfficeCli([
          "set",
          params.workingDocxPath,
          "/body",
          "--find",
          findArg,
          "--replace",
          fr.replace,
          "--prop",
          `revision.author=${author}`,
          "--json",
        ]);
        let parsed: { matched?: number; success?: boolean } | undefined;
        try {
          parsed = JSON.parse(result.stdout) as { matched?: number; success?: boolean };
        } catch {
          /* non-json ok */
        }
        if (result.code !== 0 || parsed?.success === false) {
          lastError = (result.stderr || result.stdout || `exit_${result.code}`).slice(0, 400);
          continue;
        }
        const matched = typeof parsed?.matched === "number" ? parsed.matched : undefined;
        if (matched === 0) {
          lastError = `no_match:${fr.find.slice(0, 40)}`;
          continue;
        }
        if (typeof matched === "number" && matched > 1) {
          // 多处命中：该 hunk 整处跳过并明示（不得交付多处替换稿）。
          ambiguous += 1;
          ambiguousHunkIds.push(h.hunkId);
          if (backedUp) {
            try {
              await fs.copyFile(backupPath, params.workingDocxPath);
              lastError = `multi_match_skipped:${fr.find.slice(0, 40)}`;
              continue;
            } catch {
              /* fall through to rollbackFailed */
            }
          }
          rollbackFailed = true;
          lastError = `multi_match_rollback_failed:${fr.find.slice(0, 40)}`;
          break;
        }
        applied += 1;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  } finally {
    try {
      await fs.rm(backupPath, { force: true });
    } catch {
      /* ignore */
    }
  }
  try {
    await runOfficeCli(["close", params.workingDocxPath]);
  } catch {
    /* ignore — idle auto-flush still persists in most builds */
  }
  return {
    applied,
    attempted: hunks.length,
    ambiguous,
    ambiguousHunkIds,
    rollbackFailed: rollbackFailed || undefined,
    lastError,
  };
}

export async function renderDocxWithTrackedChanges(params: {
  draft: ArtifactDraft;
  outputDir: string;
  proposals: RedlineHunk[];
  /** Workspace root — required to resolve contractEdit.baselineRelativePath. */
  workspaceDir?: string;
  /** Lawyer project folder — file-page Word pins live here, not under workspace. */
  projectDir?: string;
  pins?: ComposeContextPin[];
  officecliCommand?: string;
  /** Prefer contractReview typography when rendering a fresh draft shell. */
  templateVariant?: string;
  /**
   * Final deliverable basename under outputDir (e.g. `合同_20260731.docx`).
   * When omitted, falls back to taskId-based names for non-matter exports.
   * Does not open Word — lawyer opens the file manually.
   */
  outputFileName?: string;
  /** Existing-Word edit: never rebuild from a template into artifacts/. */
  requireContractBaseline?: boolean;
  /** Include section provenance as Word comments in the rendered draft fallback. */
  includeProvenance?: boolean;
}): Promise<TrackedDocxRenderResult> {
  const baselineAbs = resolveContractBaselineAbsPath(
    params.workspaceDir,
    params.draft,
    params.projectDir,
    params.pins,
  );
  let inputPath: string;
  let baselineSource: "contract_file" | "rendered_draft";
  let conversionTool: string | undefined;
  let conversionFidelity: "high" | "lossy" | undefined;

  let ephemeralWorkDir: string | undefined;
  if (baselineAbs) {
    if (/\.doc$/i.test(baselineAbs) && !/\.docx$/i.test(baselineAbs)) {
      try {
        const prepared = await ephemeralDocxWorkingCopy(baselineAbs);
        inputPath = prepared.docxPath;
        ephemeralWorkDir = prepared.workDir;
        conversionTool = prepared.conversionTool;
        conversionFidelity = prepared.conversionFidelity;
        baselineSource = "contract_file";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: `doc_baseline_prepare_failed:${msg}`,
          code: "baseline_prepare_failed",
        };
      }
    } else {
      inputPath = baselineAbs;
      baselineSource = "contract_file";
      conversionFidelity = "high";
    }
  } else {
    if (
      params.requireContractBaseline ||
      (params.draft.contractEdit?.baselineRelativePath?.trim() && params.workspaceDir)
    ) {
      return {
        ok: false,
        error: "contract_baseline_missing",
        code: "baseline_missing",
      };
    }
    const plain = await renderDocxWithOptions(params.draft, params.outputDir, {
      templateVariant: params.templateVariant,
      includeProvenance: params.includeProvenance,
    });
    if (!plain.outputPath) {
      return { ok: false, error: "plain_render_failed", code: "plain_render_failed" };
    }
    inputPath = plain.outputPath;
    baselineSource = "rendered_draft";
  }

  await fs.mkdir(params.outputDir, { recursive: true });
  const deliverableName =
    params.outputFileName?.trim() ||
    `${params.draft.taskId}${baselineSource === "contract_file" ? ".contract" : ""}.tracked.docx`;
  const trackedPath = path.join(params.outputDir, deliverableName);
  // Keep manifests under artifacts-style sidecar next to deliverable (same dir, hidden from lawyer naming).
  const manifestPath = path.join(params.outputDir, `.${params.draft.taskId}.redline-manifest.json`);
  const writeManifest = async (applyResult?: {
    applied: number;
    attempted: number;
    ambiguous: number;
    ambiguousHunkIds: string[];
    lastError?: string;
  }) =>
    fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          proposals: params.proposals.map((h) => ({
            hunkId: h.hunkId,
            sectionIndex: h.sectionIndex,
            sectionHeading: h.sectionHeading,
            before: h.before,
            after: h.after,
            status: h.status,
            // 交付侧实际结果：多处命中被回滚跳过的 hunk 明示为 ambiguous。
            applyStatus: applyResult?.ambiguousHunkIds.includes(h.hunkId) ? "ambiguous" : undefined,
            spanStart: h.spanStart,
            spanEnd: h.spanEnd,
            granularity: h.granularity,
          })),
          plainPath: inputPath,
          baselineSource,
          conversionTool,
          conversionFidelity,
          outputFileName: deliverableName,
          applyResult: applyResult
            ? {
                applied: applyResult.applied,
                attempted: applyResult.attempted,
                ambiguous: applyResult.ambiguous,
                lastError: applyResult.lastError,
              }
            : undefined,
          // Explicit: engine must never shell-open Word; lawyer opens the file.
          openWord: false,
        },
        null,
        2,
      ),
      "utf8",
    );
  await writeManifest();

  const cleanupEphemeral = async () => {
    if (!ephemeralWorkDir) {
      return;
    }
    try {
      await fs.rm(ephemeralWorkDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  const hunks = actionableHunks(params.proposals);
  const hadProposals = hunks.length > 0;
  const lossyConversion = conversionFidelity === "lossy";
  const conversionWarning = lossyConversion
    ? "基线 .doc 仅经 textutil 转写，原有字体/版式/审阅修订可能已丢失；请安装 Microsoft Word 或 LibreOffice 后重导以保留原格式。"
    : undefined;

  const withConversionMeta = (
    result: Extract<TrackedDocxRenderResult, { ok: true }>,
  ): Extract<TrackedDocxRenderResult, { ok: true }> => {
    const warning = [conversionWarning, result.warning].filter(Boolean).join("；") || undefined;
    if (result.outputPath) {
      const exportEvent = createProvenanceEvent("export", "system", {
        sourceId: result.outputPath,
        comment: "tracked_docx",
      });
      params.draft.sections = params.draft.sections.map((section) => ({
        ...section,
        provenance: appendProvenanceEvent(section.provenance, exportEvent),
      }));
    }
    return {
      ...result,
      conversionTool,
      conversionFidelity,
      degraded: result.degraded || lossyConversion || undefined,
      warning,
    };
  };

  /** When tracked apply fails: prefer draft body (already edited), else baseline copy. */
  const buildPlainFallback = async (): Promise<TrackedDocxRenderResult> => {
    const fallbackName = deliverableName.replace(/\.docx$/i, ".plain.docx");
    const dest = path.join(params.outputDir, fallbackName);

    if (hadProposals && (params.draft.sections?.length ?? 0) > 0) {
      try {
        // Bypass lawyer sign-off gate: this is a degraded emergency export of edited body,
        // not a client-facing final. Tracked path already skipped that gate.
        const draftForFallback: ArtifactDraft = {
          ...params.draft,
          reviewStatus: "approved",
        };
        const rendered = await renderDocxWithOptions(draftForFallback, params.outputDir, {
          templateVariant: params.templateVariant,
          includeProvenance: params.includeProvenance,
        });
        if (rendered.ok && rendered.outputPath) {
          if (path.resolve(rendered.outputPath) !== path.resolve(dest)) {
            await fs.copyFile(rendered.outputPath, dest);
            try {
              await fs.unlink(rendered.outputPath);
            } catch {
              /* keep both if unlink fails */
            }
          }
          return withConversionMeta({
            ok: true,
            outputPath: dest,
            mode: "plain_fallback",
            baselineSource,
            degraded: true,
          });
        }
      } catch {
        /* fall through to baseline copy */
      }
    }

    if (baselineSource === "contract_file") {
      try {
        await fs.copyFile(inputPath, dest);
      } catch {
        return {
          ok: false,
          error: hadProposals
            ? "审阅痕迹写入失败，且未能生成可读的备用稿（请确认本机 Microsoft Word / LibreOffice / officecli 可用；无需律师先转格式）"
            : "导出失败，且未能生成可读的备用稿",
          code: "tracked_render_failed",
        };
      }
      return withConversionMeta({
        ok: true,
        outputPath: dest,
        mode: "plain_fallback",
        baselineSource,
        degraded: hadProposals || undefined,
      });
    }

    return withConversionMeta({
      ok: true,
      outputPath: inputPath,
      mode: "plain_fallback",
      baselineSource,
      degraded: hadProposals || undefined,
    });
  };

  const refuseTemplateFallback =
    baselineSource === "contract_file" || params.requireContractBaseline === true;

  const failTrackedApply = async (detail?: string): Promise<TrackedDocxRenderResult> => {
    try {
      await fs.unlink(trackedPath);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: detail?.trim()
        ? `未能在原件副本上写入审阅痕迹：${detail.trim()}`
        : "未能在原件副本上写入审阅痕迹（请确认本机 officecli 可写该副本；不会用模板重建）。",
      code: "tracked_apply_failed",
    };
  };

  try {
    // Working copy under the final deliverable path (never mutate lawyer originals).
    // Prior failed runs may have left a 0444 sibling; unlock/replace it first.
    try {
      await fs.chmod(trackedPath, 0o644);
    } catch {
      /* dest may not exist yet */
    }
    await fs.copyFile(inputPath, trackedPath);
    try {
      await fs.chmod(trackedPath, 0o644);
    } catch {
      /* ignore */
    }

    if (!hadProposals) {
      return withConversionMeta({
        ok: true,
        outputPath: trackedPath,
        mode: "officecli",
        baselineSource,
        appliedHunks: 0,
      });
    }

    const locked =
      params.workspaceDir && params.draft.taskId
        ? readRedlineProposal(params.workspaceDir, params.draft.taskId)
        : undefined;
    const sectionBodiesBefore = locked?.baselineSections?.map((s) => s.body ?? "") ?? undefined;
    const apply = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: trackedPath,
      proposals: params.proposals,
      sectionBodiesAfter: params.draft.sections?.map((s) => s.body ?? ""),
      sectionBodiesBefore,
    });
    await writeManifest(apply);

    if (apply.rollbackFailed) {
      // 多处命中且回滚失败——交付副本已不可信，按写入失败处理，绝不交付。
      try {
        await fs.unlink(trackedPath);
      } catch {
        /* ignore */
      }
      if (refuseTemplateFallback) {
        return await failTrackedApply(apply.lastError);
      }
      return await buildPlainFallback();
    }

    if (apply.applied > 0) {
      const partial = apply.applied < apply.attempted || (apply.ambiguous ?? 0) > 0;
      const partialWarning = partial
        ? [
            `已叠加 ${apply.applied}/${apply.attempted} 处修订，未应用 ${apply.attempted - apply.applied} 处`,
            apply.ambiguous > 0 ? `其中歧义跳过 ${apply.ambiguous} 处` : "",
            apply.lastError ? `（${apply.lastError}）` : "",
          ]
            .filter(Boolean)
            .join("；")
        : undefined;
      return withConversionMeta({
        ok: true,
        outputPath: trackedPath,
        mode: "officecli",
        baselineSource,
        appliedHunks: apply.applied,
        // Partial / ambiguous apply must surface as degraded so Fleet / 交办 don't look clean.
        degraded: partial || undefined,
        warning: partialWarning,
      });
    }

    if (refuseTemplateFallback) {
      return await failTrackedApply(apply.lastError);
    }
    return await buildPlainFallback();
  } catch (err) {
    if (refuseTemplateFallback) {
      return await failTrackedApply(err instanceof Error ? err.message : String(err));
    }
    return await buildPlainFallback();
  } finally {
    await cleanupEphemeral();
  }
}
