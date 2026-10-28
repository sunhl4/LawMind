/**
 * 因子观察总线。
 *
 * 所有只读观察（律师修正、综合征、witness、关系核对、审稿、回合汇总）
 * 走同一条落盘通道。观察不是证据：不写 FactorState、不升级读数、不改稿。
 * 任何落盘失败都必须吞掉，观察不能打断回合。
 */

import {
  appendFactorLedgerRecord,
  type FactorLedgerKind,
  type FactorLedgerRecord,
} from "../adapters/factor-ledger/index.js";
import type { CorrectionRecord } from "./correction-ledger.js";
import type { SyndromeObservation } from "./syndrome-observer.js";

export type FactorObservationScope = {
  sessionId: string;
  matterId?: string;
};

export type FactorObservationInput = {
  kind: FactorLedgerKind;
  at?: string;
  turnId?: string;
  payload: Record<string, unknown>;
};

export function recordFactorObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  observation: FactorObservationInput,
): FactorLedgerRecord | undefined {
  const sessionId = scope.sessionId.trim();
  if (!sessionId) {
    return undefined;
  }
  try {
    return appendFactorLedgerRecord(workspaceDir, {
      v: 1,
      at: observation.at ?? new Date().toISOString(),
      kind: observation.kind,
      sessionId,
      ...(scope.matterId?.trim() ? { matterId: scope.matterId.trim() } : {}),
      ...(observation.turnId?.trim() ? { turnId: observation.turnId.trim() } : {}),
      payload: observation.payload,
    });
  } catch {
    return undefined;
  }
}

export function recordCorrectionObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  record: CorrectionRecord,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "correction",
    at: record.at,
    ...(turnId ? { turnId } : {}),
    payload: record as unknown as Record<string, unknown>,
  });
}

export type RepairObservation = {
  action: "bounce" | "deliver";
  anchors: readonly string[];
  note?: string;
};

export function recordRepairObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  observation: RepairObservation,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "repair",
    ...(turnId ? { turnId } : {}),
    payload: {
      action: observation.action,
      anchors: [...observation.anchors],
      ...(observation.note ? { note: observation.note } : {}),
    },
  });
}

export function recordSyndromeObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  observation: SyndromeObservation,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "syndrome",
    ...(turnId ? { turnId } : {}),
    payload: {
      bits: observation.bits,
      decoded: observation.decoded,
      note: observation.note,
    },
  });
}

export function recordWitnessObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  payload: Record<string, unknown>,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "witness",
    ...(turnId ? { turnId } : {}),
    payload,
  });
}

export function recordRelationObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  payload: Record<string, unknown>,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "relation",
    ...(turnId ? { turnId } : {}),
    payload,
  });
}

export function recordReviewObservation(
  workspaceDir: string,
  scope: FactorObservationScope,
  payload: Record<string, unknown>,
  turnId?: string,
): FactorLedgerRecord | undefined {
  return recordFactorObservation(workspaceDir, scope, {
    kind: "review",
    ...(turnId ? { turnId } : {}),
    payload,
  });
}
