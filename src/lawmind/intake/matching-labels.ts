/**
 * 从律师真实操作里取判案标注：只有律师亲手归案（`filing.by === "lawyer"`）才算标签。
 *
 * 系统自动归案不能当 ground truth——那是拿自己的结论考自己；忽略与待处理也不产生
 * 标签——「没归案」不等于「不属于任何案件」。案件已结案的标签跳过：索引里没有它，
 * 算进评测只会制造假阴性。
 */

import {
  evaluateIntakeMatching,
  type MatchingEvalCase,
  type MatchingEvalReport,
} from "./matching-eval.js";
import { buildIntakeMatterIndex } from "./matter-index.js";
import { listIntakeItems } from "./store.js";

/** `listIntakeItems` 单次最多回 500 条；达到上限时说明更老的来件没进评测。 */
const SCAN_LIMIT = 500;

export type MatchingLabelSource = {
  labeled: number;
  skippedAutoAttached: number;
  skippedIgnored: number;
  skippedPending: number;
  skippedClosedMatter: number;
  scanLimit: number;
  /** `true` 表示扫描可能被上限截断，分数只代表最近这批来件。 */
  scanMayBeTruncated: boolean;
};

export type WorkspaceMatchingEval = MatchingEvalReport & {
  source: MatchingLabelSource;
};

export function collectLawyerMatchingCases(workspaceDir: string): {
  cases: MatchingEvalCase[];
  source: MatchingLabelSource;
} {
  const index = buildIntakeMatterIndex(workspaceDir);
  const openMatters = new Set(index.matters.map((matter) => matter.matterId));
  const items = listIntakeItems(workspaceDir, {
    limit: SCAN_LIMIT,
    statuses: ["pending", "attached", "ignored"],
  });
  const source: MatchingLabelSource = {
    labeled: 0,
    skippedAutoAttached: 0,
    skippedIgnored: 0,
    skippedPending: 0,
    skippedClosedMatter: 0,
    scanLimit: SCAN_LIMIT,
    scanMayBeTruncated: items.length >= SCAN_LIMIT,
  };
  const cases: MatchingEvalCase[] = [];
  for (const item of items) {
    if (item.status === "attached") {
      if (item.filing?.by !== "lawyer") {
        source.skippedAutoAttached += 1;
        continue;
      }
      if (!openMatters.has(item.filing.matterId)) {
        source.skippedClosedMatter += 1;
        continue;
      }
      cases.push({ item, expectedMatterId: item.filing.matterId });
      source.labeled += 1;
    } else if (item.status === "ignored") {
      source.skippedIgnored += 1;
    } else {
      source.skippedPending += 1;
    }
  }
  return { cases, source };
}

/** 从工作区的律师归案记录直接跑判案评测；没有标签时返回 null 指标。 */
export function evaluateWorkspaceMatching(workspaceDir: string): WorkspaceMatchingEval {
  const index = buildIntakeMatterIndex(workspaceDir);
  const { cases, source } = collectLawyerMatchingCases(workspaceDir);
  return { ...evaluateIntakeMatching(index, cases), source };
}
