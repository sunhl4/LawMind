/**
 * 把桌面端渲染结果回填给 Word 插件请求（闭环的最后一段）。
 *
 * 只在有排队中的插件请求时才做事：没有插件、没有请求、回填失败，都不影响导出本身。
 */

import path from "node:path";
import type { RedlineHunk } from "../../drafts/redline-proposal.js";
import {
  hunksFromRedlineProposal,
  listWordAddinReviews,
  updateWordAddinReview,
  type WordAddinHunk,
} from "./review-requests.js";

function sameSourcePath(a: string, b: string): boolean {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

/** 独立审稿给律师看的一行（advisory 姿态下必须让律师在 Word 里看到）。 */
export type WordAddinGuardianAdvisory = {
  verdict: string;
  gaps: Array<{ code: string; message: string }>;
};

/** 部分落改：产物有效但只叠加了一部分，必须如实告知。 */
export type WordAddinPartialHunks = { applied: number; attempted: number };

function guardianAdvisoryNote(guardian: WordAddinGuardianAdvisory): string | undefined {
  if (guardian.verdict !== "fail" || guardian.gaps.length === 0) {
    return undefined;
  }
  const first = guardian.gaps[0];
  const head =
    guardian.gaps.length > 1
      ? `独立审稿提示 ${guardian.gaps.length} 处（首条）`
      : "独立审稿提示 1 处";
  return `${head}：${first?.message ?? first?.code ?? ""}`;
}

/** 把「部分落改」与「审稿缺口」合成窗格里那一行 note。 */
function buildReadyNote(params: {
  partialHunks?: WordAddinPartialHunks;
  guardian?: WordAddinGuardianAdvisory;
}): string | undefined {
  const parts: string[] = [];
  const partial = params.partialHunks;
  if (partial && partial.applied < partial.attempted) {
    parts.push(
      `本次叠加 ${partial.applied}/${partial.attempted} 处修订，${
        partial.attempted - partial.applied
      } 处原文未匹配（已缓办，请到桌面端看）。`,
    );
  }
  const advisory = params.guardian ? guardianAdvisoryNote(params.guardian) : undefined;
  if (advisory) {
    parts.push(advisory);
  }
  return parts.length > 0 ? `修订稿已出（可正常「改这份」）。${parts.join(" ")}` : undefined;
}

/**
 * 渲染出带修订轨的审阅稿后调用：把产物路径与可落改锚点回填给匹配的插件请求。
 * 匹配口径：源文件绝对路径相同；缺源路径时退化为文件名相同。
 *
 * `guardian`：独立审稿结论。审稿在 advisory 姿态下不阻断导出，但它的缺口必须随结果一起
 * 交到律师手上（job report 里有，Word 窗格里也要有），否则等于悄悄交货。
 */
export async function attachWordAddinResultForSource(params: {
  workspaceDir: string;
  sourceAbs?: string;
  outputPath: string;
  hunks: RedlineHunk[];
  summary?: string;
  guardian?: WordAddinGuardianAdvisory;
  partialHunks?: WordAddinPartialHunks;
  taskId?: string;
}): Promise<{ attached: string[] }> {
  const pending = [
    ...listWordAddinReviews(params.workspaceDir, { state: "queued" }),
    ...listWordAddinReviews(params.workspaceDir, { state: "running" }),
  ];
  if (pending.length === 0) {
    return { attached: [] };
  }
  const source = params.sourceAbs?.trim();
  const matches = pending.filter((row) =>
    source
      ? sameSourcePath(row.sourcePath, source)
      : row.fileName.toLowerCase() === path.basename(params.outputPath).toLowerCase(),
  );
  if (matches.length === 0) {
    return { attached: [] };
  }
  const derived = hunksFromRedlineProposal({ hunks: params.hunks });
  const note = buildReadyNote({
    ...(params.partialHunks ? { partialHunks: params.partialHunks } : {}),
    ...(params.guardian ? { guardian: params.guardian } : {}),
  });
  const attached: string[] = [];
  for (const row of matches) {
    const hunks: WordAddinHunk[] = derived.hunks;
    const summaryBase = params.summary ?? "审查完成";
    // 没拿到任何可落改锚点（例如全是不上插件的整节重写）时补一句说明，别让 summary 干巴巴。
    const summary =
      hunks.length === 0 && derived.skippedSectionHunks > 0
        ? `${summaryBase}（无可就地落改锚点；另有 ${derived.skippedSectionHunks} 处整节重写请回桌面端看）`
        : hunks.length === 0
          ? `${summaryBase}（无可就地落改锚点）`
          : summaryBase;
    const updated = await updateWordAddinReview(params.workspaceDir, row.id, {
      state: "ready",
      outputPath: params.outputPath,
      hunks,
      skippedSectionHunks: derived.skippedSectionHunks,
      summary,
      ...(params.taskId?.trim() ? { taskId: params.taskId.trim() } : {}),
      ...(note ? { note } : {}),
    });
    if (updated.ok) {
      attached.push(row.id);
    }
  }
  return { attached };
}

/**
 * 工具结果补丁：回填成功时给字段与提示，否则给空对象。
 */
export function wordAddinResultPatch(attachedIds: string[]): {
  wordAddin?: { attachedRequestIds: string[]; message: string };
} {
  if (attachedIds.length === 0) {
    return {};
  }
  return {
    wordAddin: {
      attachedRequestIds: attachedIds,
      message: "Word 插件该次就地审查已可取回：插件刷新后即可把修订轨落进 Word。",
    },
  };
}

/**
 * 同上，但**永不抛**：导出主流程的旁路，回填失败不得影响本次交付。
 */
export async function attachWordAddinResultSafely(params: {
  workspaceDir: string;
  sourceAbs?: string;
  outputPath: string;
  hunks: RedlineHunk[];
  summary?: string;
  guardian?: WordAddinGuardianAdvisory;
  partialHunks?: WordAddinPartialHunks;
  taskId?: string;
}): Promise<string[]> {
  try {
    const result = await attachWordAddinResultForSource(params);
    return result.attached;
  } catch {
    return [];
  }
}
