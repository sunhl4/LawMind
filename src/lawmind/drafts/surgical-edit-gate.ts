/**
 * Rewrite-amplitude metrics for contract draft updates.
 * Default product path is soft (metrics + coaching).
 * Hard reject only via `evaluateSurgicalEditGateHard` or env `LAWMIND_SURGICAL_ENFORCE=1`
 * on the update_draft call site.
 */

import { computeRewriteAmplitude, draftPlainText } from "../learning/rewrite-amplitude.js";
import { appendProductMetric } from "../metrics/product-metrics.js";
import type { ArtifactDraft } from "../types.js";
import type { SurgicalCraftSignal } from "./contract-redline-craft.js";

export type SurgicalEditGateResult = {
  ok: true;
  absCharDelta: number;
  absParagraphDelta: number;
  ratio: number | null;
  /** True when Δ exceeded soft thresholds (coaching / audit only). */
  exceededSoftThreshold: boolean;
  maxAbsCharDelta: number;
  maxRatio: number;
  message?: string;
};

/**
 * Soft thresholds for coaching (not product hard reject).
 * Default: 25% of source (floor 40) and 400 abs chars — stricter of the two.
 */
export function resolveSurgicalEditLimits(env: NodeJS.ProcessEnv = process.env): {
  maxAbsCharDelta: number;
  maxRatio: number;
} {
  const maxAbs = Number(env.LAWMIND_SURGICAL_MAX_ABS_CHAR_DELTA ?? "");
  const maxRatio = Number(env.LAWMIND_SURGICAL_MAX_RATIO ?? "");
  return {
    maxAbsCharDelta: Number.isFinite(maxAbs) && maxAbs > 0 ? maxAbs : 400,
    maxRatio: Number.isFinite(maxRatio) && maxRatio > 0 && maxRatio <= 1 ? maxRatio : 0.25,
  };
}

/**
 * Approximate changed-character mass via common prefix/suffix strip.
 * Length-only |after−before| misses near-total rewrites of similar length.
 */
export function estimateChangedChars(before: string, after: string): number {
  if (before === after) {
    return 0;
  }
  let start = 0;
  const minLen = Math.min(before.length, after.length);
  while (start < minLen && before[start] === after[start]) {
    start += 1;
  }
  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const removed = Math.max(0, endBefore - start + 1);
  const inserted = Math.max(0, endAfter - start + 1);
  return removed + inserted;
}

export function surgicalAmplitudeEnforceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LAWMIND_SURGICAL_ENFORCE?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "on";
}

export function evaluateSurgicalEditGate(params: {
  beforeDraft: ArtifactDraft;
  afterDraft: ArtifactDraft;
}): SurgicalEditGateResult {
  const beforeText = draftPlainText(params.beforeDraft);
  const afterText = draftPlainText(params.afterDraft);
  const amp = computeRewriteAmplitude(beforeText, afterText);
  const changedChars = estimateChangedChars(beforeText, afterText);
  const ratio = amp.charBefore > 0 ? changedChars / amp.charBefore : changedChars > 0 ? 1 : 0;
  const { maxAbsCharDelta, maxRatio } = resolveSurgicalEditLimits();
  const percentLimit = Math.max(40, Math.floor(amp.charBefore * maxRatio));
  const limit = Math.min(percentLimit, maxAbsCharDelta);
  const exceededSoftThreshold = changedChars > percentLimit || changedChars > maxAbsCharDelta;
  return {
    ok: true,
    absCharDelta: changedChars,
    absParagraphDelta: amp.absParagraphDelta,
    ratio,
    exceededSoftThreshold,
    maxAbsCharDelta: limit,
    maxRatio,
    ...(exceededSoftThreshold
      ? {
          message: `改写幅度较大（Δ${changedChars} 字，约 ${((ratio ?? 0) * 100).toFixed(1)}%）。建议优先 apply_surgical_edits 字/词级落改，或确认后走 Redline 提案供律师 Accept。`,
        }
      : {}),
  };
}

/** Legacy hard reject — only for explicit abuse/tests; not used on default update_draft path. */
export function evaluateSurgicalEditGateHard(params: {
  beforeDraft: ArtifactDraft;
  afterDraft: ArtifactDraft;
}):
  | SurgicalEditGateResult
  | {
      ok: false;
      code: "rewrite_amplitude_exceeded";
      absCharDelta: number;
      absParagraphDelta: number;
      ratio: number | null;
      maxAbsCharDelta: number;
      maxRatio: number;
      message: string;
    } {
  const soft = evaluateSurgicalEditGate(params);
  if (!soft.exceededSoftThreshold) {
    return soft;
  }
  return {
    ok: false,
    code: "rewrite_amplitude_exceeded",
    absCharDelta: soft.absCharDelta,
    absParagraphDelta: soft.absParagraphDelta,
    ratio: soft.ratio,
    maxAbsCharDelta: soft.maxAbsCharDelta,
    maxRatio: soft.maxRatio,
    message:
      soft.message ?? `改写幅度过大（Δ${soft.absCharDelta} 字）。请仅修改必须改的字词后重试。`,
  };
}

export function craftSignalsFromAmplitudeGate(gate: SurgicalEditGateResult): SurgicalCraftSignal[] {
  if (!gate.exceededSoftThreshold) {
    return [];
  }
  return [
    {
      level: "warn",
      code: "rewrite_amplitude_soft",
      message:
        gate.message ??
        "改写幅度超过软阈值；建议 apply_surgical_edits 或收窄 sections 改点（不阻断落盘）。",
    },
  ];
}

export function attachRewriteAmplitudeMeta(
  draft: ArtifactDraft,
  gate: SurgicalEditGateResult,
): ArtifactDraft {
  return {
    ...draft,
    rewriteAmplitude: {
      absCharDelta: gate.absCharDelta,
      absParagraphDelta: gate.absParagraphDelta,
      ratio: gate.ratio,
      gated: gate.exceededSoftThreshold,
      at: new Date().toISOString(),
    },
  };
}

export function auditSurgicalEditGateSoft(params: {
  workspaceDir: string;
  taskId: string;
  matterId?: string;
  gate: SurgicalEditGateResult;
}): void {
  if (!params.gate.exceededSoftThreshold) {
    return;
  }
  try {
    appendProductMetric(params.workspaceDir, {
      kind: "gate_failure",
      outcome: "surgical_rewrite_amplitude_soft",
      taskId: params.taskId,
      detail: `Δ${params.gate.absCharDelta};ratio=${params.gate.ratio ?? "n/a"}`,
    });
  } catch {
    /* best-effort */
  }
}

/** @deprecated Prefer CONTRACT_REDLINE_CRAFT_SKILL — kept as thin pointer for non-mail contract turns. */
export const SURGICAL_CONTRACT_EDIT_PROMPT = [
  "## 合同改稿",
  "- 质量标准见 Craft Skill：最小修改=最短锚定（能改几个字就只改几个字；段内只改有问题的句子）。",
  "- 落改优先 `apply_surgical_edits`，并附 `craft_check`；空修订不得导出。",
  "- 若有原合同路径：`update_draft`/`draft_document` 须带 `contract_edit_baseline_path`（除非草稿已有 contractEdit）。",
].join("\n");
