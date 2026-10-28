/**
 * 判案回归评测：把律师标注的「期望案件」喂给同一套 resolve 逻辑，
 * 记录 false attach（自动归错案）与 recall@1 / proposal recall。
 *
 * 这里只做评测，不改判案规则：自动归案仍由 `resolve.ts` 的强键与唯一性决定。
 * 真实回件与律师改判数据到位前，先用合成集守住「false attach = 0」这条硬线。
 */

import { resolveIntakeItem, type IntakeMatterIndex } from "./resolve.js";
import type { IntakeDecision, IntakeItem, IntakeKeyKind } from "./types.js";

export type MatchingEvalCase = {
  item: IntakeItem;
  /** null 表示这条来件本来就不属于任何在办案件。 */
  expectedMatterId: string | null;
};

export type MatchingEvalRow = {
  itemId: string;
  expectedMatterId: string | null;
  decision: IntakeDecision;
  topMatterId?: string;
  /** 期望案件在候选里的名次（从 1 起）；没命中为 null。 */
  expectedRank: number | null;
  /** 这条来件命中的线索类型；只用于排查，不参与放行。 */
  keyKinds: IntakeKeyKind[];
};

export type MatchingEvalReport = {
  total: number;
  autoAttach: number;
  /** 自动归到错误案件（或本来不该归案）的条数；必须为 0 才能放行新规则。 */
  falseAttach: number;
  /** 自动归案里正确的比例；没有自动归案时为 null。 */
  autoAttachPrecision: number | null;
  /** 有期望案件的条目里，候选第一名正确的比例；没有这类条目时为 null。 */
  recallAt1: number | null;
  /** 有期望案件的条目里，期望案件出现在候选里的比例；没有这类条目时为 null。 */
  proposalRecall: number | null;
  rows: MatchingEvalRow[];
  falseAttachRows: MatchingEvalRow[];
};

export function evaluateIntakeMatching(
  index: IntakeMatterIndex,
  cases: readonly MatchingEvalCase[],
): MatchingEvalReport {
  const rows: MatchingEvalRow[] = cases.map(({ item, expectedMatterId }) => {
    const resolution = resolveIntakeItem(item, index);
    const candidates = resolution.candidates;
    const rank = expectedMatterId
      ? candidates.findIndex((candidate) => candidate.matterId === expectedMatterId) + 1
      : 0;
    const top = candidates[0];
    return {
      itemId: item.id,
      expectedMatterId,
      decision: resolution.decision,
      ...(top ? { topMatterId: top.matterId } : {}),
      expectedRank: rank > 0 ? rank : null,
      keyKinds: [
        ...new Set(candidates.flatMap((candidate) => candidate.keys.map((key) => key.kind))),
      ].toSorted(),
    };
  });
  const autoRows = rows.filter((row) => row.decision === "auto_attach");
  const falseAttachRows = autoRows.filter(
    (row) => row.expectedMatterId === null || row.topMatterId !== row.expectedMatterId,
  );
  const labeled = rows.filter((row) => row.expectedMatterId !== null);
  const top1 = labeled.filter((row) => row.expectedRank === 1).length;
  const proposed = labeled.filter((row) => row.expectedRank !== null).length;
  return {
    total: rows.length,
    autoAttach: autoRows.length,
    falseAttach: falseAttachRows.length,
    autoAttachPrecision:
      autoRows.length === 0 ? null : (autoRows.length - falseAttachRows.length) / autoRows.length,
    recallAt1: labeled.length === 0 ? null : top1 / labeled.length,
    proposalRecall: labeled.length === 0 ? null : proposed / labeled.length,
    rows,
    falseAttachRows,
  };
}
