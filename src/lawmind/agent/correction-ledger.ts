/**
 * 方向 5「律师修正史当校准数据」第一步：把律师的「不对」落成结构化记录。
 *
 * docs/量子启发.md §二(5) 与可执行清单 #4。今天这类修正只留在对话历史，
 * 后续校准拿不到带锚、带修回结果的数据。本模块只产出记录与摘要：
 * - 记录带锚（命中的锚 + 撤回光锥）、修回结果、律师原话；
 * - 修订原因（纠错 / 偏好 / 新事实 / 立场分歧）留给人工或后续标注，
 *   禁止按关键词自动猜测（否则「未被发现」会被学成「正确」）；
 * - 落库走 memory/kernel 既有 write-gateway；本模块不做任何读写。
 */

import { z } from "zod";
import { decisionDistance } from "./evidence-provenance.js";
import { normalizeOutcomes, projectReading, purity, type FactorState } from "./factor-state.js";

export const CorrectionRevertResultSchema = z.object({
  anchor: z.string().min(1),
  ok: z.boolean(),
  /** 失败原因（如同一替换词出现次数对不上），保留给校准用。 */
  detail: z.string().optional(),
});
export type CorrectionRevertResult = z.infer<typeof CorrectionRevertResultSchema>;

export const CorrectionReadingSnapshotSchema = z.object({
  anchor: z.string().min(1),
  /** 修正前的账本读法；混合态用「；」连接。 */
  reading: z.string(),
  purity: z.number().min(0).max(1),
  grounded: z.boolean(),
  /** 胜出读法独有的来源根数；0 表示没有唯一胜出读法或没有来源根。 */
  distance: z.number().int().nonnegative(),
  /** 该读数是否有来源根。没有来源根时 distance 不可解释。 */
  provenance: z.boolean().default(false),
  /** 修复计划选择的故障类别；没有译码器记录时为空。 */
  faultKinds: z.array(z.string()).default([]),
});
export type CorrectionReadingSnapshot = z.infer<typeof CorrectionReadingSnapshotSchema>;

export const CorrectionOutcomeSchema = z.enum(["reverted", "partial", "kept"]);
export type CorrectionOutcome = z.infer<typeof CorrectionOutcomeSchema>;

export const CorrectionRecordSchema = z.object({
  at: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  /** 律师修正原话（单行截断）。不是证据，不得注入采样提示。 */
  lawyerNote: z.string(),
  namedAnchors: z.array(z.string()),
  /** 撤回光锥内被波及的锚（含未点名的 1-hop 邻居）。 */
  coneAnchors: z.array(z.string()),
  reverts: z.array(CorrectionRevertResultSchema),
  outcome: CorrectionOutcomeSchema,
  /**
   * 修订原因分类。第一阶段恒为 null；自动猜测会把未被发现学成正确。
   */
  reason: z.null(),
  /** 修正前的读数快照，供保形校准使用；缺省为空。 */
  readings: z.array(CorrectionReadingSnapshotSchema).default([]),
  /** 落到草稿/Word 的逆补丁实际应用次数。 */
  fileEditsReverted: z.number().int().nonnegative().optional(),
});
export type CorrectionRecord = z.infer<typeof CorrectionRecordSchema>;

export type CorrectionDigest = {
  total: number;
  byOutcome: Record<CorrectionOutcome, number>;
  revertAttempts: number;
  revertOk: number;
  revertFailed: number;
  /** 未标注修订原因的记录数；校准入模前必须先补标签。 */
  unclassified: number;
  /** 带修正前读数快照的记录数，决定保形校准能不能用。 */
  withReadings: number;
  /** 落到草稿/Word 的逆补丁实际应用次数合计。 */
  fileEditsReverted: number;
};

export type CorrectionRecordInput = {
  sessionId?: string;
  turnId?: string;
  lawyerNote?: string;
  namedAnchors?: readonly string[];
  coneAnchors?: readonly string[];
  reverts?: readonly CorrectionRevertResult[];
  readings?: readonly (Omit<CorrectionReadingSnapshot, "faultKinds"> & {
    faultKinds?: readonly string[];
  })[];
  fileEditsReverted?: number;
  faultKinds?: readonly string[];
};

const NOTE_MAX_CHARS = 160;

function trimmedAnchors(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((anchor) => anchor.trim()).filter(Boolean))];
}

/** 律师说了「不对」，但没点名锚也没有可修回内容：kept，缺数据都要记。 */
function outcomeOf(
  reverts: readonly CorrectionRevertResult[],
  fileEditsReverted: number,
): CorrectionOutcome {
  if (reverts.length === 0 && fileEditsReverted === 0) {
    return "kept";
  }
  if (reverts.some((revert) => !revert.ok)) {
    return "partial";
  }
  return "reverted";
}

export function buildCorrectionRecord(input: CorrectionRecordInput): CorrectionRecord {
  const faultKinds = [
    ...new Set((input.faultKinds ?? []).map((kind) => kind.trim()).filter(Boolean)),
  ];
  const reverts = (input.reverts ?? []).map((revert) => ({
    anchor: revert.anchor.trim(),
    ok: revert.ok,
    ...(revert.detail?.trim() ? { detail: revert.detail.trim() } : {}),
  }));
  const readings = (input.readings ?? [])
    .map((reading) => ({
      anchor: reading.anchor.trim(),
      reading: reading.reading.trim(),
      purity: Math.min(1, Math.max(0, reading.purity)),
      grounded: reading.grounded,
      distance: Math.max(0, Math.floor(reading.distance)),
      provenance: reading.provenance,
      faultKinds: [
        ...new Set(
          [...(reading.faultKinds ?? []), ...faultKinds].map((kind) => kind.trim()).filter(Boolean),
        ),
      ],
    }))
    .filter((reading) => reading.anchor);
  const fileEditsReverted =
    input.fileEditsReverted === undefined ? 0 : Math.max(0, Math.floor(input.fileEditsReverted));
  return {
    at: new Date().toISOString(),
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
    ...(input.turnId?.trim() ? { turnId: input.turnId.trim() } : {}),
    lawyerNote: (input.lawyerNote ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX_CHARS),
    namedAnchors: trimmedAnchors(input.namedAnchors),
    coneAnchors: trimmedAnchors(input.coneAnchors),
    reverts,
    outcome: outcomeOf(reverts, fileEditsReverted),
    reason: null,
    readings,
    ...(fileEditsReverted > 0 ? { fileEditsReverted } : {}),
    ...(faultKinds.length > 0 ? { faultKinds } : {}),
  };
}

export function summarizeCorrectionRecords(records: readonly CorrectionRecord[]): CorrectionDigest {
  const digest: CorrectionDigest = {
    total: 0,
    byOutcome: { reverted: 0, partial: 0, kept: 0 },
    revertAttempts: 0,
    revertOk: 0,
    revertFailed: 0,
    unclassified: 0,
    withReadings: 0,
    fileEditsReverted: 0,
  };
  for (const record of records) {
    digest.total += 1;
    digest.byOutcome[record.outcome] += 1;
    digest.revertAttempts += record.reverts.length;
    digest.revertOk += record.reverts.filter((revert) => revert.ok).length;
    digest.revertFailed += record.reverts.filter((revert) => !revert.ok).length;
    if (record.reason === null) {
      digest.unclassified += 1;
    }
    if (record.readings.length > 0) {
      digest.withReadings += 1;
    }
    digest.fileEditsReverted += record.fileEditsReverted ?? 0;
  }
  return digest;
}

/**
 * 修正前读数快照。只读；用于把「哪条读法被律师改掉」变成校准行。
 * 没有对应因子的锚不补造读数。
 */
export function correctionReadingSnapshot(
  state: FactorState | undefined,
  anchors: readonly string[],
): CorrectionReadingSnapshot[] {
  if (!state) {
    return [];
  }
  const out: CorrectionReadingSnapshot[] = [];
  for (const anchor of new Set(anchors.map((value) => value.trim()).filter(Boolean))) {
    const factor = state.factors.find((item) => item.anchor === anchor);
    if (!factor) {
      continue;
    }
    const outcomes = normalizeOutcomes(factor.outcomes);
    const reading = projectReading(outcomes);
    const provenance = outcomes.some((outcome) => (outcome.channels?.length ?? 0) > 0);
    out.push({
      anchor,
      reading: reading.kind === "definite" ? reading.id : reading.ids.join("；"),
      purity: purity(outcomes),
      grounded: outcomes.some((outcome) => outcome.grounded === true),
      distance: provenance ? decisionDistance(outcomes).distance : 0,
      provenance,
      faultKinds: [],
    });
  }
  return out;
}
