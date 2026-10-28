/**
 * 用律师修正史给保形门做校准。
 *
 * 只做两件事：
 * 1. 把 `CorrectionRecord.readings` 变成带分数的校准行；
 * 2. 只有「行数够、且有区分度」时才写入 `FactorState.conformalScores`。
 *
 * 关键限制：`kept` 只表示「这次没有被撤回」，不是正确标签。校准行保留
 * gold 字段，但不把 kept 当真理；没有区分度的数据宁可不启用门。
 */

import {
  readFactorLedgerRecords,
  type FactorLedgerScope,
} from "../adapters/factor-ledger/index.js";
import { CorrectionRecordSchema, type CorrectionRecord } from "./correction-ledger.js";
import {
  MIN_CONFORMAL_CALIBRATION,
  setConformalCalibration,
  type FactorState,
} from "./factor-state.js";

export type CorrectionCalibrationRow = {
  anchor: string;
  reading: string;
  purity: number;
  grounded: boolean;
  distance: number;
  /** 该读数是否有来源根；没有根时 distance 不可解释。 */
  provenance: boolean;
  /** 译码器选择的故障类型，用于分层校准；旧记录为空。 */
  faultKinds: string[];
  /** reverted = 律师明确撤回；kept = 点名了但没有可撤回内容，不是正确标签。 */
  gold: "reverted" | "kept";
  score: number;
};

export type CalibrationStatus =
  | {
      status: "ready";
      scores: number[];
      rows: number;
      informative: number;
      needed: number;
    }
  | {
      status: "insufficient" | "uninformative";
      scores: [];
      rows: number;
      informative: number;
      needed: number;
    };

/**
 * 结构分数：纯度占一半，独立来源距离占一半。
 * 单源高纯度读法的分数不会因为「写得确定」而变低；它仍可能被下一轮修正。
 */
export function structuralNonconformity(row: {
  purity: number;
  grounded: boolean;
  distance: number;
  /** 缺省视为有来源根；显式 false 时距离不计入支持度。 */
  provenance?: boolean;
}): number {
  if (!row.grounded) {
    return 1;
  }
  const purity = Number.isFinite(row.purity) ? Math.min(1, Math.max(0, row.purity)) : 0;
  const support = row.provenance === false ? 0 : Math.min(1, Math.max(0, row.distance) / 2);
  return 1 - 0.5 * purity - 0.5 * support;
}

export function buildCalibrationRows(
  records: readonly CorrectionRecord[],
): CorrectionCalibrationRow[] {
  const rows: CorrectionCalibrationRow[] = [];
  for (const record of records) {
    const reverted = new Set(
      record.reverts.filter((revert) => revert.ok).map((revert) => revert.anchor),
    );
    for (const reading of record.readings) {
      rows.push({
        anchor: reading.anchor,
        reading: reading.reading,
        purity: reading.purity,
        grounded: reading.grounded,
        distance: reading.distance,
        provenance: reading.provenance,
        faultKinds: reading.faultKinds,
        gold: reverted.has(reading.anchor) ? "reverted" : "kept",
        score: structuralNonconformity(reading),
      });
    }
  }
  return rows;
}

function isInformative(row: CorrectionCalibrationRow): boolean {
  return !row.grounded || row.purity < 0.999 || (row.provenance && row.distance < 2);
}

export function calibrationStatusFromRows(
  rows: readonly CorrectionCalibrationRow[],
  needed = MIN_CONFORMAL_CALIBRATION,
): CalibrationStatus {
  const informative = rows.filter(isInformative).length;
  if (rows.length < needed || informative < needed) {
    return {
      status: informative === 0 && rows.length > 0 ? "uninformative" : "insufficient",
      scores: [],
      rows: rows.length,
      informative,
      needed,
    };
  }
  return {
    status: "ready",
    scores: rows.map((row) => row.score),
    rows: rows.length,
    informative,
    needed,
  };
}

export function applyCorrectionCalibration(
  state: FactorState,
  records: readonly CorrectionRecord[],
): CalibrationStatus {
  const status = calibrationStatusFromRows(buildCalibrationRows(records));
  if (status.status === "ready") {
    setConformalCalibration(state, status.scores);
  }
  return status;
}

/** 读账本里的修正记录；坏行/旧行由 schema 过滤。 */
export function loadCorrectionRecords(
  workspaceDir: string,
  scope: FactorLedgerScope,
  limit = 500,
): CorrectionRecord[] {
  const records = readFactorLedgerRecords(workspaceDir, scope, { limit });
  const out: CorrectionRecord[] = [];
  for (const record of records) {
    if (record.kind !== "correction") {
      continue;
    }
    const parsed = CorrectionRecordSchema.safeParse(record.payload);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }
  return out;
}

/**
 * 回合开始调用：已有足够分数就不重复读盘；否则从账本重建一次。
 * 读盘失败不阻塞回合，返回 insufficient。
 */
export function applyLedgerCalibration(
  workspaceDir: string,
  session: { sessionId: string; matterId?: string; factorState?: FactorState },
): CalibrationStatus {
  const state = session.factorState;
  if (!state) {
    return {
      status: "insufficient",
      scores: [],
      rows: 0,
      informative: 0,
      needed: MIN_CONFORMAL_CALIBRATION,
    };
  }
  if ((state.conformalScores ?? []).length >= MIN_CONFORMAL_CALIBRATION) {
    return {
      status: "ready",
      scores: state.conformalScores ?? [],
      rows: state.conformalScores?.length ?? 0,
      informative: state.conformalScores?.length ?? 0,
      needed: MIN_CONFORMAL_CALIBRATION,
    };
  }
  try {
    return applyCorrectionCalibration(
      state,
      loadCorrectionRecords(workspaceDir, {
        sessionId: session.sessionId,
        ...(session.matterId ? { matterId: session.matterId } : {}),
      }),
    );
  } catch {
    return {
      status: "insufficient",
      scores: [],
      rows: 0,
      informative: 0,
      needed: MIN_CONFORMAL_CALIBRATION,
    };
  }
}

export function renderCalibrationStatus(status: CalibrationStatus): string {
  if (status.status === "ready") {
    return `【校准】保形门已启用：${status.scores.length} 条分数，${status.informative} 条有区分度。`;
  }
  return `【校准】保形门未启用（${status.status}）：${status.rows} 条读数，${status.informative} 条有区分度，需要 ${status.needed} 条。`;
}
