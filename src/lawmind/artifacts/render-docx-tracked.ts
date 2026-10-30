/**
 * Export Word with tracked changes via officecli (bundled with LawMind).
 * Prefers an uploaded contract baseline `.docx` when `draft.contractEdit` is set.
 * Binary `.doc` is converted first (Microsoft Word Save As, then LibreOffice). That `.docx` is the baseline.
 * If neither can convert, stop and ask the lawyer. The original `.doc` is left untouched.
 *
 * Tracked changes use modern officecli:
 *   `set <file> /body --find … --replace … --prop revision.author=… --prop revision.date=…`
 * Regex finds use the official `r"..."` prefix on --find (not a separate prop).
 * (the legacy `docx apply-redlines` subcommand is not available on current CLIs).
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  computeMinimalEditSpans,
  consumedFindText,
  revisionMarkupIsMinimal,
} from "../drafts/minimal-edit-script.js";
import { appendProvenanceEvent, createProvenanceEvent } from "../drafts/provenance.js";
import type { RedlineHunk } from "../drafts/redline-proposal.js";
import { readRedlineProposal } from "../drafts/redline-proposal.js";
import { planRevisionTimestamps } from "../drafts/revision-timestamps.js";
import {
  disambiguateLiteralFind,
  formatOfficeCliFindArg,
  toTrackedFindReplace,
} from "../drafts/surgical-diff.js";
import { repairTrackedDocxFormat } from "../drafts/tracked-format-gate.js";
import { convertLegacyDocToDocx } from "../mail/convert-to-docx.js";
import { DOC_NEEDS_DOCX_CODE, isBinaryWordDocBaseline } from "../mail/doc-revision-gate.js";
import type { ComposeContextPin } from "../platform/compose-context-pin.js";
import { buildMinimalChildEnv, runSafeCommand } from "../platform/safe-command.js";
import { resolveWordRevisionAuthor } from "../policy/word-revision-author.js";
import { readWorkspacePolicyFile } from "../policy/workspace-policy.js";
import { resolveWorkspaceRelativePath } from "../runtime/workspace-path.js";
import type { ArtifactDraft } from "../types.js";
import { resolveOfficeCliBin } from "./officecli-bin.js";
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
       * (durable plain / draft-body copy only). Callers must surface this.
       */
      degraded?: boolean;
      /** Number of redline hunks successfully applied via officecli find/replace. */
      appliedHunks?: number;
      /** 实际落下的 officecli find/replace 操作数（最短改动会把一处 hunk 拆成多段）。 */
      appliedOps?: number;
      /** 因「夹着没改的文字」被自动拆成多段最短改动的 hunk 数。 */
      minimalSplitHunks?: number;
      /** 只落了部分最短 op 的 hunk 数（修订不完整，结果必为 degraded）。 */
      partialOpHunks?: number;
      /** 导出后把修订 run 对齐邻接原稿格式时修复的 run 数。 */
      formatRepaired?: number;
      conversionTool?: string;
      conversionFidelity?: "high" | "lossy";
      warning?: string;
    }
  | { ok: false; error: string; code: string };

/** officecli JSON 可能较长；审计仍只记摘要，这里抬高捕获上限以免截断 matched 字段。 */
const OFFICECLI_MAX_STDOUT = 256_000;
const OFFICECLI_MAX_STDERR = 8_000;

/**
 * 修订清单落点：优先 LawMind 工作区 `cache/redline-manifests/`，
 * 不写律师 projectDir / 交付同级目录。无 workspace 时（单测临时目录）才旁路到 outputDir。
 */
export function resolveRedlineManifestPath(params: {
  workspaceDir?: string;
  taskId: string;
  outputDir: string;
}): string {
  const leaf = `.${params.taskId.trim() || "task"}.redline-manifest.json`;
  const workspace = params.workspaceDir?.trim();
  if (workspace) {
    return path.join(workspace, "cache", "redline-manifests", leaf);
  }
  return path.join(params.outputDir, leaf);
}

async function runOfficeCli(
  args: string[],
  timeoutMs = 120_000,
  command?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = command?.trim() || resolveOfficeCliBin() || "officecli";
  try {
    const result = await runSafeCommand({
      command: bin,
      args,
      env: buildMinimalChildEnv(),
      timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      maxStdoutBytes: OFFICECLI_MAX_STDOUT,
      maxStderrBytes: OFFICECLI_MAX_STDERR,
    });
    if (result.exitSignal === "SIGTERM" || result.exitSignal === "SIGKILL") {
      throw new Error("officecli_timeout");
    }
    return {
      code: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    if (err instanceof Error && err.message === "officecli_timeout") {
      throw err;
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
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
  if (!/\.docx$/i.test(abs) && !isBinaryWordDocBaseline(abs)) {
    return undefined;
  }
  if (!fsSync.existsSync(abs)) {
    return undefined;
  }
  return abs;
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
 *
 * 单处版本（诊断/兼容用）：取该 hunk 最短化后的**最左一处** op。
 * 真正落盘请用 resolveOfficeCliFindReplaceOps —— 一处 hunk 可能含多段最短改动。
 */
export function resolveOfficeCliFindReplace(
  hunk: RedlineHunk,
  sectionBodyAfter?: string,
): { find: string; replace: string; regex?: boolean } | null {
  const ops = resolveOfficeCliFindReplaceOps(hunk, sectionBodyAfter);
  const first = ops[ops.length - 1];
  if (!first) {
    return null;
  }
  return {
    find: first.find,
    replace: first.replace,
    ...(first.regex ? { regex: true as const } : {}),
  };
}

export type OfficeCliFindReplaceOp = {
  find: string;
  replace: string;
  regex?: boolean;
  /** 该处改动在**基线本节正文**里的起点（用于歧义锚点定位；无法定位时缺省）。 */
  spanStart?: number;
};

/**
 * 把一处 hunk 展开为**若干互不重叠的最短 op**（最短改动硬不变量）：
 *
 * 「一句话里只改几个字」时，绝不能整句删+整句增——那会让同事无法逐处接受，
 * 也会把别人手上的修订轨冲掉。所以这里不信任 hunk 的粒度（历史 section hunk
 * 的 before/after 可能是整节），一律用 computeMinimalEditSpans 重算：
 * 保留文字留在修订轨之外，只把真正变动的字标成删除/新增。
 *
 * 顺序按**从右到左**返回：officecli 的歧义锚点用的是 lookbehind（右侧被改前、
 * 左侧文字须仍是原文），从右往左落盘可保证每一处应用时左侧都还没被动过。
 */
export function resolveOfficeCliFindReplaceOps(
  hunk: RedlineHunk,
  sectionBodyAfter?: string,
  sectionBodyBefore?: string,
): OfficeCliFindReplaceOp[] {
  const before = hunk.before ?? "";
  const after = hunk.after ?? "";
  if (before === after) {
    return [];
  }
  const spans = computeMinimalEditSpans(before, after);
  if (spans.length === 0) {
    return [];
  }
  // hunk.before 在基线正文里的位置：span 的下标是相对 hunk.before 的，落盘时要换算成节内绝对位。
  const baseOffset = sectionBodyBefore && before ? sectionBodyBefore.indexOf(before) : -1;
  const ops: OfficeCliFindReplaceOp[] = [];
  for (const span of spans) {
    const spanStart =
      baseOffset >= 0
        ? baseOffset + span.spanStart
        : typeof hunk.spanStart === "number"
          ? hunk.spanStart
          : undefined;
    const tracked = toTrackedFindReplace({
      before: span.before,
      after: span.after,
      bodyAfter: sectionBodyAfter,
    });
    if (tracked) {
      pushMinimal(ops, { ...tracked, ...(spanStart !== undefined ? { spanStart } : {}) });
      continue;
    }
    // 纯插入定位失败时不把左右没改的字包进 find/replace。宁可这一处不落，也不写成整句删增。
    if (span.before.trim().length > 0) {
      pushMinimal(ops, {
        find: span.before,
        replace: span.after,
        ...(spanStart !== undefined ? { spanStart } : {}),
      });
    }
  }
  return ops.toSorted((a, b) => (b.spanStart ?? 0) - (a.spanStart ?? 0));
}

function pushMinimal(ops: OfficeCliFindReplaceOp[], op: OfficeCliFindReplaceOp): void {
  const deleted = consumedFindText(op.find, op.regex);
  if (!revisionMarkupIsMinimal(deleted, op.replace)) {
    return;
  }
  ops.push(op);
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
  officecliCommand?: string;
  /** 真实导出时刻；测试可注入。默认取当下。 */
  now?: Date;
  /** 修订时间排布的稳定种子；默认取各 hunk 的 id。 */
  timestampSeed?: string;
  /** 最早可用的显示时间（原合同文件 mtime）；避免修订时间早于基线文件。 */
  notBefore?: Date;
}): Promise<{
  applied: number;
  attempted: number;
  ambiguous: number;
  /** matched>1 被回滚跳过的 hunk——调用方须写入 manifest 并明示 partial。 */
  ambiguousHunkIds: string[];
  /** 各处 hunk 写进 Word 的显示时间（按 hunkId）；真实导出时刻由调用方另记。 */
  revisionDates?: Record<string, string>;
  /** 多处命中且回滚失败：交付副本不可信，调用方不得交付。 */
  rollbackFailed?: boolean;
  lastError?: string;
  /** 落改成功的 hunk 数（一处 hunk 可能拆成多个最短 op）。 */
  appliedHunks?: number;
  /** 因「一处改动夹了未改文字」被拆成多段最短改动的 hunk 数。 */
  minimalSplitHunks?: number;
  /** 只落了部分最短 op 的 hunk 数（修订不完整，调用方必须按 degraded 对待）。 */
  partialOpHunks?: number;
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
  // 修订时间按一次真人审阅的节奏展开；真实导出时刻不进 Word，由 manifest 记录。
  const revisionDates = planRevisionTimestamps({
    count: hunks.length,
    seed: params.timestampSeed ?? (hunks.map((hunk) => hunk.hunkId).join("|") || author),
    ...(params.now ? { now: params.now } : {}),
    ...(params.notBefore ? { notBefore: params.notBefore } : {}),
  });
  const revisionDateByHunk = new Map(
    hunks.map((hunk, index) => [hunk.hunkId, revisionDates[index]]),
  );
  const uniquenessBodies = params.sectionBodiesBefore?.length
    ? params.sectionBodiesBefore
    : params.sectionBodiesAfter;
  let applied = 0;
  let appliedHunks = 0;
  let ambiguous = 0;
  let minimalSplitHunks = 0;
  let partialOpHunks = 0;
  let rollbackFailed = false;
  const ambiguousHunkIds: string[] = [];
  /** 至少落了一处 op 的 hunk；manifest 只记录这些 hunk 显示时间。 */
  const appliedHunkIds = new Set<string>();
  let lastError: string | undefined;
  // 每个 op 落盘前先备份工作副本：officecli 报 matched>1 时整体回滚，
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
      // 最短改动硬不变量：先重算成若干最短 op（保留文字不进修订轨），再从右往左落盘。
      const ops = resolveOfficeCliFindReplaceOps(h, bodyAfter, sectionBodyBefore);
      if (ops.length === 0) {
        lastError = `unresolvable_hunk:${(h.before || h.after).slice(0, 40)}`;
        continue;
      }
      if (ops.length > 1) {
        minimalSplitHunks += 1;
      }
      // ① 先把该 hunk 的所有 op 解析完（歧义锚点定位），任一不可定位即整处跳过——
      //    半落一处的修订稿比不落更难核对。
      const resolved: OfficeCliFindReplaceOp[] = [];
      let blockedReason: string | undefined;
      for (const op of ops) {
        let fr: OfficeCliFindReplaceOp = op;
        if (fr.regex) {
          if (countRegexInBodies(uniquenessBodies, fr.find) > 1) {
            blockedReason = `ambiguous_match:${fr.find.slice(0, 40)}`;
            break;
          }
        } else if (countInBodies(uniquenessBodies, fr.find) > 1) {
          const pinned = disambiguateLiteralFind({
            find: fr.find,
            replace: fr.replace,
            sectionBody: sectionBodyBefore ?? "",
            spanStart: fr.spanStart,
            uniquenessBodies: uniquenessBodies ?? [],
          });
          if (!pinned) {
            blockedReason = `ambiguous_match:${fr.find.slice(0, 40)}`;
            break;
          }
          fr = { ...pinned };
        }
        resolved.push(fr);
      }
      if (blockedReason) {
        ambiguous += 1;
        ambiguousHunkIds.push(h.hunkId);
        lastError = blockedReason;
        continue;
      }
      // ② 逐 op 落盘（resolveOfficeCliFindReplaceOps 已按从右到左排序）。
      // 只落一部分也算不完整修订：partialOpHunks 记录这种 hunk，调用方必须 degraded。
      let hunkApplied = 0;
      for (const fr of resolved) {
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
          const revisionDate = revisionDateByHunk.get(h.hunkId);
          const result = await runOfficeCli(
            [
              "set",
              params.workingDocxPath,
              "/body",
              "--find",
              findArg,
              "--replace",
              fr.replace,
              "--prop",
              `revision.author=${author}`,
              ...(revisionDate ? ["--prop", `revision.date=${revisionDate}`] : []),
              "--json",
            ],
            120_000,
            params.officecliCommand,
          );
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
                break;
              } catch {
                /* fall through to rollbackFailed */
              }
            }
            rollbackFailed = true;
            lastError = `multi_match_rollback_failed:${fr.find.slice(0, 40)}`;
            break;
          }
          applied += 1;
          hunkApplied += 1;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (hunkApplied > 0) {
        appliedHunks += 1;
        appliedHunkIds.add(h.hunkId);
      }
      if (hunkApplied > 0 && hunkApplied < resolved.length) {
        partialOpHunks += 1;
      }
      if (rollbackFailed) {
        break;
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
    await runOfficeCli(["close", params.workingDocxPath], 120_000, params.officecliCommand);
  } catch {
    /* ignore — idle auto-flush still persists in most builds */
  }
  return {
    applied,
    attempted: hunks.length,
    ambiguous,
    ambiguousHunkIds,
    revisionDates: Object.fromEntries(
      hunks.flatMap((hunk, index) => {
        const date = revisionDates[index];
        return date && appliedHunkIds.has(hunk.hunkId) ? [[hunk.hunkId, date] as const] : [];
      }),
    ),
    rollbackFailed: rollbackFailed || undefined,
    lastError,
    appliedHunks,
    ...(minimalSplitHunks > 0 ? { minimalSplitHunks } : {}),
    ...(partialOpHunks > 0 ? { partialOpHunks } : {}),
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
  /**
   * 修订署名。不传时读工作区策略；策略空白则 LawMind。
   * 显式传入时不再读策略（测试与调用方覆盖）。
   */
  author?: string;
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
  /** 真实导出时刻；测试可注入。默认取当下。 */
  now?: Date;
}): Promise<TrackedDocxRenderResult> {
  const baselineAbs = resolveContractBaselineAbsPath(
    params.workspaceDir,
    params.draft,
    params.projectDir,
    params.pins,
  );
  let inputPath: string;
  let baselineSource: "contract_file" | "rendered_draft";
  let conversionFidelity: "high" | "lossy" | undefined;
  /** `.doc` 转换稿的临时路径；交付副本拷好后要删掉，别留在交付目录。 */
  let legacyConvertedPath: string | undefined;
  /**
   * `.doc` 是二进制容器，读不出原有修订条目，只能对账「有没有带过来」。
   * 这条提示必须随交付物一起给律师，不能默认认为修订一定还在。
   */
  let docConversionNote: string | undefined;
  /** 修订对账的软提示（别人插入句被改、编号被重排），随交付信息给律师。 */
  const revisionNotes: string[] = [];

  if (baselineAbs) {
    if (isBinaryWordDocBaseline(baselineAbs)) {
      // `.doc` 先转成保真 `.docx`（Word 优先，LibreOffice 兜底），再在转换稿上落改。
      const converted = path.join(
        params.outputDir,
        `.${path.basename(baselineAbs).replace(/\.doc$/i, "")}.from-doc.docx`,
      );
      const result = await convertLegacyDocToDocx(baselineAbs, converted);
      if (!result.ok) {
        // 硬失败：没有转换器就不出稿，不能拿正文替身冒充原件。
        return { ok: false, error: result.error, code: DOC_NEEDS_DOCX_CODE };
      }
      legacyConvertedPath = converted;
      inputPath = converted;
      baselineSource = "contract_file";
      conversionFidelity = "high";
      {
        const { countDocxRevisions } = await import("../drafts/word-revision/preservation-file.js");
        const counted = await countDocxRevisions(converted);
        docConversionNote = counted.ok
          ? `原件是 .doc，原有修订条目无法逐条对账。转成 .docx 后已有 ${counted.count} 条修订（本轮新增另计），请在 Word 里核对原有修订是否都在。`
          : "原件是 .doc，且转换稿读不出修订条目，请人工核对原有修订是否还在。";
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
      // 审阅痕迹路径：即使临时拼壳也不走交件去 AI 味。
      applyDeliverableDeai: false,
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
  // 修订清单进 LawMind 工作区 cache，不进律师案件夹/交付目录（避免 Finder 里一堆 .json）。
  const manifestPath = resolveRedlineManifestPath({
    workspaceDir: params.workspaceDir,
    taskId: params.draft.taskId,
    outputDir: params.outputDir,
  });
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  // 真实导出时刻（审计口径）。Word 里显示的修订时间是按审阅节奏展开的，两者分开记。
  const exportedAt = (params.now ?? new Date()).toISOString();
  const writeManifest = async (applyResult?: {
    applied: number;
    attempted: number;
    ambiguous: number;
    ambiguousHunkIds: string[];
    revisionDates?: Record<string, string>;
    lastError?: string;
  }) =>
    fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          exportedAt,
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
          conversionFidelity,
          outputFileName: deliverableName,
          applyResult: applyResult
            ? {
                applied: applyResult.applied,
                attempted: applyResult.attempted,
                ambiguous: applyResult.ambiguous,
                revisionDates: applyResult.revisionDates,
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

  const hunks = actionableHunks(params.proposals);
  const hadProposals = hunks.length > 0;

  const withConversionMeta = (
    result: Extract<TrackedDocxRenderResult, { ok: true }>,
  ): Extract<TrackedDocxRenderResult, { ok: true }> => {
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
      conversionFidelity,
      warning:
        [result.warning, docConversionNote, ...revisionNotes].filter(Boolean).join("；") ||
        undefined,
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
          applyDeliverableDeai: false,
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
            ? "审阅痕迹写入失败，且未能生成可读的备用稿（请确认本机 officecli 可用；基线须为 .docx）"
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

  /**
   * 硬约束：交付物必须保留原稿里的每一条修订。
   * officecli 落改、格式修复、另存都可能把别人的 w:ins / w:del 弄丢；
   * 一旦对不上，宁可不交付，也不能让律师拿着少了修订的稿子去谈。
   */
  const guardRevisionPreservation = async (
    afterAbs: string,
  ): Promise<TrackedDocxRenderResult | undefined> => {
    const { verifyDocxRevisionPreservation } =
      await import("../drafts/word-revision/preservation-file.js");
    const check = await verifyDocxRevisionPreservation({
      beforeAbs: inputPath,
      afterAbs,
    });
    if (!check.verified) {
      // 读不出原件（如 .doc 转换稿已被清理）：不谎称通过，交给调用方在 warning 里说明。
      return undefined;
    }
    if (!check.ok) {
      try {
        await fs.unlink(afterAbs);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        code: "revision_preservation_failed",
        error: `${check.note ?? "交付物丢失了原有修订。"}已停止交付。请在 Word 里打开原件另存一份 .docx 后重试，或改用「只读核对」。`,
      };
    }
    const { describeInsertionEdits, describeRenumbered } =
      await import("../drafts/word-revision/preservation.js");
    const insertionNote = describeInsertionEdits(check);
    if (insertionNote) {
      revisionNotes.push(insertionNote);
    }
    const renumberNote = describeRenumbered(check);
    if (renumberNote) {
      revisionNotes.push(renumberNote);
    }
    return undefined;
  };

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
    {
      await fs.copyFile(inputPath, trackedPath);
      // 转换稿只是中间产物：交付副本已拿到，删掉隐藏的临时文件。
      if (legacyConvertedPath && path.resolve(legacyConvertedPath) !== path.resolve(trackedPath)) {
        try {
          await fs.unlink(legacyConvertedPath);
        } catch {
          /* keep it if unlink fails */
        }
      }
    }
    try {
      await fs.chmod(trackedPath, 0o644);
    } catch {
      /* ignore */
    }

    if (!hadProposals) {
      const lost = await guardRevisionPreservation(trackedPath);
      if (lost) {
        return lost;
      }
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
    let revisionNotBefore: Date | undefined;
    if (baselineSource === "contract_file" && !legacyConvertedPath) {
      // 修订显示时间不能早于原合同出现的时间。转换稿的 mtime 是刚生成的，不能当锚点。
      try {
        revisionNotBefore = new Date((await fs.stat(inputPath)).mtimeMs);
      } catch {
        /* stat 失败就只按导出时刻倒推 */
      }
    }
    const author =
      params.author !== undefined
        ? resolveWordRevisionAuthor(params.author)
        : resolveWordRevisionAuthor(
            params.workspaceDir
              ? readWorkspacePolicyFile(params.workspaceDir)?.wordRevisionAuthor
              : undefined,
          );
    const apply = await applyRedlineHunksWithOfficeCli({
      workingDocxPath: trackedPath,
      proposals: params.proposals,
      author,
      sectionBodiesAfter: params.draft.sections?.map((s) => s.body ?? ""),
      sectionBodiesBefore,
      officecliCommand: params.officecliCommand,
      timestampSeed: params.draft.taskId,
      ...(params.now ? { now: params.now } : {}),
      ...(revisionNotBefore ? { notBefore: revisionNotBefore } : {}),
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
      // attempted/applied 以 hunk 计（最短改动可能把一处 hunk 拆成多段 op，全落即算该处已落）。
      const appliedHunks = apply.appliedHunks ?? apply.applied;
      const partialOps = apply.partialOpHunks ?? 0;
      const partial =
        appliedHunks < apply.attempted || (apply.ambiguous ?? 0) > 0 || partialOps > 0;
      const partialWarning = partial
        ? [
            `已叠加 ${appliedHunks}/${apply.attempted} 处修订，未应用 ${apply.attempted - appliedHunks} 处`,
            apply.ambiguous > 0 ? `其中歧义跳过 ${apply.ambiguous} 处` : "",
            partialOps > 0 ? `其中 ${partialOps} 处只落了部分最短改动，修订不完整` : "",
            apply.lastError ? `（${apply.lastError}）` : "",
          ]
            .filter(Boolean)
            .join("；")
        : undefined;
      const minimalNote =
        (apply.minimalSplitHunks ?? 0) > 0
          ? `已按最短改动把 ${apply.minimalSplitHunks} 处拆成多段（只标真正变动的字，没动的字不在修订轨内）。`
          : undefined;
      // 硬控：officecli 可能写出无 rPr 的修订 run；对齐邻接原稿直接格式后再交付。
      let formatRepaired = 0;
      let formatWarning: string | undefined;
      try {
        const format = await repairTrackedDocxFormat(trackedPath);
        formatRepaired = format.repaired;
        if (format.unresolved.length > 0) {
          formatWarning = `有 ${format.unresolved.length} 处修订文字未能对齐原稿格式`;
        }
      } catch {
        formatWarning = "修订文字格式对齐修复失败";
      }
      const lost = await guardRevisionPreservation(trackedPath);
      if (lost) {
        return lost;
      }
      return withConversionMeta({
        ok: true,
        outputPath: trackedPath,
        mode: "officecli",
        baselineSource,
        appliedHunks,
        appliedOps: apply.applied,
        minimalSplitHunks: apply.minimalSplitHunks,
        ...(partialOps > 0 ? { partialOpHunks: partialOps } : {}),
        formatRepaired: formatRepaired || undefined,
        // Partial / ambiguous apply must surface as degraded so Fleet / 交办 don't look clean.
        degraded: partial || Boolean(formatWarning) || undefined,
        warning:
          [partialWarning, minimalNote, formatWarning].filter(Boolean).join("；") || undefined,
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
  }
}
