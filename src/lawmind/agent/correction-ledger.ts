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

export type CorrectionRevertResult = {
  anchor: string;
  ok: boolean;
  /** 失败原因（如同一替换词出现次数对不上），保留给校准用。 */
  detail?: string;
};

export type CorrectionOutcome = "reverted" | "partial" | "kept";

export type CorrectionRecord = {
  at: string;
  sessionId?: string;
  turnId?: string;
  /** 律师修正原话（单行截断）。不是证据，不得注入采样提示。 */
  lawyerNote: string;
  namedAnchors: string[];
  /** 撤回光锥内被波及的锚（含未点名的 1-hop 邻居）。 */
  coneAnchors: string[];
  reverts: CorrectionRevertResult[];
  outcome: CorrectionOutcome;
  /**
   * 修订原因分类。第一阶段恒为 null；自动猜测会把未被发现学成正确。
   */
  reason: null;
};

export type CorrectionDigest = {
  total: number;
  byOutcome: Record<CorrectionOutcome, number>;
  revertAttempts: number;
  revertOk: number;
  revertFailed: number;
  /** 未标注修订原因的记录数；校准入模前必须先补标签。 */
  unclassified: number;
};

export type CorrectionRecordInput = {
  sessionId?: string;
  turnId?: string;
  lawyerNote?: string;
  namedAnchors?: readonly string[];
  coneAnchors?: readonly string[];
  reverts?: readonly CorrectionRevertResult[];
};

const NOTE_MAX_CHARS = 160;

function trimmedAnchors(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((anchor) => anchor.trim()).filter(Boolean))];
}

/** 律师说了「不对」，但没点名锚也没有可修回内容：kept，缺数据都要记。 */
function outcomeOf(reverts: readonly CorrectionRevertResult[]): CorrectionOutcome {
  if (reverts.length === 0) {
    return "kept";
  }
  if (reverts.every((revert) => revert.ok)) {
    return "reverted";
  }
  return "partial";
}

export function buildCorrectionRecord(input: CorrectionRecordInput): CorrectionRecord {
  const reverts = (input.reverts ?? []).map((revert) => ({
    anchor: revert.anchor.trim(),
    ok: revert.ok,
    ...(revert.detail?.trim() ? { detail: revert.detail.trim() } : {}),
  }));
  return {
    at: new Date().toISOString(),
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
    ...(input.turnId?.trim() ? { turnId: input.turnId.trim() } : {}),
    lawyerNote: (input.lawyerNote ?? "").trim().replace(/\s+/g, " ").slice(0, NOTE_MAX_CHARS),
    namedAnchors: trimmedAnchors(input.namedAnchors),
    coneAnchors: trimmedAnchors(input.coneAnchors),
    reverts,
    outcome: outcomeOf(reverts),
    reason: null,
  };
}

export function summarizeCorrectionRecords(records: readonly CorrectionRecord[]): CorrectionDigest {
  const digest: CorrectionDigest = {
    total: records.length,
    byOutcome: { reverted: 0, partial: 0, kept: 0 },
    revertAttempts: 0,
    revertOk: 0,
    revertFailed: 0,
    unclassified: 0,
  };
  for (const record of records) {
    digest.byOutcome[record.outcome] += 1;
    digest.revertAttempts += record.reverts.length;
    digest.revertOk += record.reverts.filter((revert) => revert.ok).length;
    digest.revertFailed += record.reverts.filter((revert) => !revert.ok).length;
    if (record.reason === null) {
      digest.unclassified += 1;
    }
  }
  return digest;
}
