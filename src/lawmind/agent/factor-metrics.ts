/**
 * 因子账本指标。只读聚合，不参与判定。
 *
 * 指标口径：
 * - 修正：reverted / partial / kept、带读数快照的记录数、逆补丁次数；
 * - 综合征：事件数、涉及锚数、译码结果分布；
 * - 回合汇总：因子数、确定/混合、红灯数、决策距离分布。
 *
 * 不把「警告数」当质量；误报密度和漏报要成对看。
 */

import type { FactorLedgerKind, FactorLedgerRecord } from "../adapters/factor-ledger/index.js";
import { CorrectionRecordSchema } from "./correction-ledger.js";

const LEDGER_KINDS: readonly FactorLedgerKind[] = [
  "correction",
  "syndrome",
  "repair",
  "witness",
  "relation",
  "review",
  "summary",
];

export type FactorLedgerDigest = {
  total: number;
  byKind: Record<FactorLedgerKind, number>;
  corrections: {
    total: number;
    reverted: number;
    partial: number;
    kept: number;
    withReadings: number;
    fileEditsReverted: number;
    zeroDistance: number;
  };
  syndromes: {
    events: number;
    uniqueAnchors: number;
    decodedUnique: number;
    ambiguous: number;
    uncorrectable: number;
  };
  repairs: {
    total: number;
    bounced: number;
    capped: number;
    anchors: number;
  };
  summaries: {
    turns: number;
    factors: number;
    definite: number;
    mixed: number;
    redLights: number;
    meanDistance: number;
    maxDistance: number;
    zeroDistance: number;
  };
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function numberAt(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numbersAt(record: Record<string, unknown> | undefined, key: string): number[] {
  const value = record?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((row): row is number => typeof row === "number" && Number.isFinite(row));
}

export function emptyFactorLedgerDigest(): FactorLedgerDigest {
  return {
    total: 0,
    byKind: Object.fromEntries(LEDGER_KINDS.map((kind) => [kind, 0])) as Record<
      FactorLedgerKind,
      number
    >,
    corrections: {
      total: 0,
      reverted: 0,
      partial: 0,
      kept: 0,
      withReadings: 0,
      fileEditsReverted: 0,
      zeroDistance: 0,
    },
    syndromes: {
      events: 0,
      uniqueAnchors: 0,
      decodedUnique: 0,
      ambiguous: 0,
      uncorrectable: 0,
    },
    repairs: {
      total: 0,
      bounced: 0,
      capped: 0,
      anchors: 0,
    },
    summaries: {
      turns: 0,
      factors: 0,
      definite: 0,
      mixed: 0,
      redLights: 0,
      meanDistance: 0,
      maxDistance: 0,
      zeroDistance: 0,
    },
  };
}

export function summarizeFactorLedger(records: readonly FactorLedgerRecord[]): FactorLedgerDigest {
  const digest = emptyFactorLedgerDigest();
  digest.total = records.length;
  const syndromeAnchors = new Set<string>();
  let distanceSum = 0;
  let distanceCount = 0;
  for (const record of records) {
    digest.byKind[record.kind] += 1;
    const payload = asRecord(record.payload);
    if (record.kind === "correction") {
      const parsed = CorrectionRecordSchema.safeParse(record.payload);
      if (!parsed.success) {
        continue;
      }
      digest.corrections.total += 1;
      digest.corrections[parsed.data.outcome] += 1;
      if (parsed.data.readings.length > 0) {
        digest.corrections.withReadings += 1;
      }
      digest.corrections.fileEditsReverted += parsed.data.fileEditsReverted ?? 0;
      digest.corrections.zeroDistance += parsed.data.readings.filter(
        (reading) => reading.distance === 0,
      ).length;
      continue;
    }
    if (record.kind === "syndrome") {
      const bits = Array.isArray(payload?.bits) ? payload.bits : [];
      if (bits.length === 0) {
        continue;
      }
      digest.syndromes.events += 1;
      for (const bit of bits) {
        const row = asRecord(bit);
        const anchor = typeof row?.anchor === "string" ? row.anchor.trim() : "";
        if (anchor) {
          syndromeAnchors.add(anchor);
        }
      }
      const decoded = asRecord(payload?.decoded);
      const kind = decoded?.kind;
      if (kind === "unique") {
        digest.syndromes.decodedUnique += 1;
      } else if (kind === "ambiguous") {
        digest.syndromes.ambiguous += 1;
      } else if (kind === "uncorrectable") {
        digest.syndromes.uncorrectable += 1;
      }
      continue;
    }
    if (record.kind === "repair") {
      const anchors = Array.isArray(payload?.anchors)
        ? payload.anchors.filter((anchor): anchor is string => typeof anchor === "string")
        : [];
      digest.repairs.total += 1;
      if (payload?.action === "bounce") {
        digest.repairs.bounced += 1;
      } else if (payload?.action === "deliver") {
        digest.repairs.capped += 1;
      }
      digest.repairs.anchors += anchors.length;
      continue;
    }
    if (record.kind === "summary") {
      digest.summaries.turns += 1;
      digest.summaries.factors += numberAt(payload, "factors");
      digest.summaries.definite += numberAt(payload, "definite");
      digest.summaries.mixed += numberAt(payload, "mixed");
      digest.summaries.redLights += numberAt(payload, "redLights");
      const distances = numbersAt(payload, "distances");
      for (const distance of distances) {
        distanceSum += distance;
        distanceCount += 1;
        digest.summaries.maxDistance = Math.max(digest.summaries.maxDistance, distance);
        if (distance === 0) {
          digest.summaries.zeroDistance += 1;
        }
      }
    }
  }
  digest.syndromes.uniqueAnchors = syndromeAnchors.size;
  digest.summaries.meanDistance = distanceCount > 0 ? distanceSum / distanceCount : 0;
  return digest;
}

export function renderFactorLedgerDigest(digest: FactorLedgerDigest): string {
  return [
    `【因子账本】${digest.total} 条记录`,
    `修正 ${digest.corrections.total}：reverted ${digest.corrections.reverted} / partial ${digest.corrections.partial} / kept ${digest.corrections.kept}；带读数 ${digest.corrections.withReadings}；逆补丁 ${digest.corrections.fileEditsReverted}；零距离读数 ${digest.corrections.zeroDistance}`,
    `综合征 ${digest.syndromes.events}：锚 ${digest.syndromes.uniqueAnchors}；唯一解 ${digest.syndromes.decodedUnique} / 同价 ${digest.syndromes.ambiguous} / 无解 ${digest.syndromes.uncorrectable}`,
    `修复 ${digest.repairs.total}：反弹 ${digest.repairs.bounced} / 封顶 ${digest.repairs.capped}；涉及锚 ${digest.repairs.anchors}`,
    `回合 ${digest.summaries.turns}：因子 ${digest.summaries.factors}；确定 ${digest.summaries.definite} / 混合 ${digest.summaries.mixed}；红灯 ${digest.summaries.redLights}；平均距离 ${digest.summaries.meanDistance.toFixed(2)}；最大 ${digest.summaries.maxDistance}；零距离 ${digest.summaries.zeroDistance}`,
  ].join("\n");
}
