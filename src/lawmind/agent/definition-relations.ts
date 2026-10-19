/**
 * 方向 7「定义环守恒」第一步：带类型、带来源、逐边核对的关系约束。
 *
 * docs/量子启发.md §二(7)，叠加本仓库 analysis 的边界修正：
 * - 不是奇偶校验。A=B、B=C、C=A 的三边环完全可能一致；异或奇偶只在
 *   预定义二元变量与同异关系上成立。别名一致性在这里是直接比较。
 * - 同段共现是路由提示，不是相等约束；建边由调用方给出，本模块只核对。
 * - 一致不等于正确：关系核对捕捉的是账本/稿内互相矛盾，不能替代外部
 *   来源核查。冲突时只留最小矛盾证据，不替律师选边。
 *
 * 只读：本模块不建边、不改 FactorState；findings 进观察通道。
 */

import { projectReading, type FactorState } from "./factor-state.js";

export type RelationKind = "alias_equality" | "amount_split" | "date_order";

export type RelationEdge =
  | {
      kind: "alias_equality";
      /** 断言两个锚的已核定义指向同一实体。 */
      anchors: [string, string];
      sourceSpan?: string;
    }
  | {
      kind: "amount_split";
      parent: string;
      parts: readonly string[];
      /** sum：各部分相加等于父；ratio：部分按比例来自父。 */
      op: "sum" | "ratio";
      /** ratio 模式必填，取 (0,1]。 */
      ratio?: number;
      /** 容差按元计，默认 1 元。 */
      toleranceYuan?: number;
    }
  | {
      kind: "date_order";
      /** 断言 left ≤ right（允许相等）。 */
      left: string;
      right: string;
    };

export type RelationConflict = {
  kind: RelationKind;
  anchors: string[];
  /** 最小矛盾证据：两侧已核读数。 */
  detail: string;
};

export type RelationInsufficient = {
  kind: RelationKind;
  anchors: string[];
  detail: string;
};

export type RelationFindings = {
  conflicts: RelationConflict[];
  insufficient: RelationInsufficient[];
};

/** 账本上某锚的确定已核读数；mixed/conflict 一律视为证据不足。 */
export function definiteReading(state: FactorState, anchor: string): string | undefined {
  const factor = state.factors.find((item) => item.anchor === anchor);
  if (!factor) {
    return undefined;
  }
  const reading = projectReading(factor.outcomes);
  if (reading.kind !== "definite") {
    return undefined;
  }
  const id = reading.id.trim();
  return id || undefined;
}

/** 「公司」是「北京示例科技有限公司」的短写：包含关系按一致处理，不报冲突。 */
function aliasesPointToSameEntity(left: string, right: string): boolean {
  return left === right || left.includes(right) || right.includes(left);
}

export function parseYmd(value: string): [number, number, number] | undefined {
  const m = /(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/.exec(value);
  if (!m) {
    return undefined;
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day) {
    return undefined;
  }
  return [year, month, day];
}

function compareYmd(left: [number, number, number], right: [number, number, number]): number {
  if (left[0] !== right[0]) {
    return left[0] - right[0];
  }
  if (left[1] !== right[1]) {
    return left[1] - right[1];
  }
  return left[2] - right[2];
}

function parseMoneyYuan(value: string): number | undefined {
  const cleaned = value.replace(/,/g, "").trim();
  const m = /^(\d+(?:\.\d+)?)\s*(万)?\s*(元)?$/.exec(cleaned);
  if (!m?.[1]) {
    return undefined;
  }
  const parsed = Number(m[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.round(parsed * (m[2] !== undefined ? 10000 : 1));
}

export function checkRelationEdges(
  state: FactorState,
  edges: readonly RelationEdge[],
): RelationFindings {
  const conflicts: RelationConflict[] = [];
  const insufficient: RelationInsufficient[] = [];
  const pushConflict = (row: RelationConflict) => conflicts.push(row);
  const pushInsufficient = (row: RelationInsufficient) => insufficient.push(row);

  for (const edge of edges) {
    if (edge.kind === "alias_equality") {
      const [left, right] = edge.anchors;
      const leftValue = definiteReading(state, left);
      const rightValue = definiteReading(state, right);
      if (!leftValue || !rightValue) {
        pushInsufficient({
          kind: edge.kind,
          anchors: edge.anchors,
          detail: `缺少已核读数：${leftValue ? right : left}`,
        });
        continue;
      }
      if (!aliasesPointToSameEntity(leftValue, rightValue)) {
        pushConflict({
          kind: edge.kind,
          anchors: edge.anchors,
          detail: `「${leftValue}」与「${rightValue}」不同，待人工核对，不选边`,
        });
      }
      continue;
    }
    if (edge.kind === "amount_split") {
      const parentValue = definiteReading(state, edge.parent);
      if (!parentValue) {
        pushInsufficient({
          kind: edge.kind,
          anchors: [edge.parent, ...edge.parts],
          detail: `父锚缺少已核读数：${edge.parent}`,
        });
        continue;
      }
      const parent = parseMoneyYuan(parentValue);
      if (parent === undefined) {
        pushInsufficient({
          kind: edge.kind,
          anchors: [edge.parent, ...edge.parts],
          detail: `父锚读数不是金额：${edge.parent}=${parentValue}`,
        });
        continue;
      }
      const partValues = edge.parts.map((anchor) => ({
        anchor,
        value: definiteReading(state, anchor),
      }));
      const missing = partValues.filter((row) => !row.value);
      if (missing.length > 0) {
        pushInsufficient({
          kind: edge.kind,
          anchors: missing.map((row) => row.anchor),
          detail: `部分锚缺少已核读数：${missing.map((row) => row.anchor).join("、")}`,
        });
        continue;
      }
      const parsedParts = partValues.map((row) => ({
        anchor: row.anchor,
        yuan: parseMoneyYuan(row.value ?? ""),
      }));
      const unparsed = parsedParts.filter((row) => row.yuan === undefined);
      if (unparsed.length > 0) {
        pushInsufficient({
          kind: edge.kind,
          anchors: unparsed.map((row) => row.anchor),
          detail: `部分锚读数不是金额：${unparsed.map((row) => row.anchor).join("、")}`,
        });
        continue;
      }
      const tolerance = edge.toleranceYuan ?? 1;
      if (edge.op === "sum") {
        const sum = parsedParts.reduce((acc, row) => acc + (row.yuan ?? 0), 0);
        if (Math.abs(sum - parent) > tolerance) {
          pushConflict({
            kind: edge.kind,
            anchors: [edge.parent, ...edge.parts],
            detail: `各部分合计 ${sum} 元，与 ${edge.parent} 已核 ${parent} 元不符`,
          });
        }
        continue;
      }
      const ratio = edge.ratio;
      if (ratio === undefined || ratio <= 0 || ratio > 1) {
        pushInsufficient({
          kind: edge.kind,
          anchors: [edge.parent, ...edge.parts],
          detail: "ratio 模式缺少合法比例 (0,1]",
        });
        continue;
      }
      for (const part of parsedParts) {
        const expected = Math.round(parent * ratio);
        const actual = part.yuan ?? 0;
        if (Math.abs(actual - expected) > tolerance) {
          pushConflict({
            kind: edge.kind,
            anchors: [edge.parent, part.anchor],
            detail: `按比例 ${ratio} 应为 ${expected} 元，${part.anchor} 已核 ${actual} 元`,
          });
        }
      }
      continue;
    }
    // date_order
    const leftValue = definiteReading(state, edge.left);
    const rightValue = definiteReading(state, edge.right);
    if (!leftValue || !rightValue) {
      pushInsufficient({
        kind: edge.kind,
        anchors: [edge.left, edge.right],
        detail: `缺少已核读数：${leftValue ? edge.right : edge.left}`,
      });
      continue;
    }
    const leftDate = parseYmd(leftValue);
    const rightDate = parseYmd(rightValue);
    if (!leftDate || !rightDate) {
      pushInsufficient({
        kind: edge.kind,
        anchors: [edge.left, edge.right],
        detail: "读数不是可解析日期",
      });
      continue;
    }
    if (compareYmd(leftDate, rightDate) > 0) {
      pushConflict({
        kind: edge.kind,
        anchors: [edge.left, edge.right],
        detail: `${edge.left}(${leftValue}) 晚于 ${edge.right}(${rightValue})，与先决顺序不符`,
      });
    }
  }
  return { conflicts, insufficient };
}

/** 渲染为观察块：冲突给最小矛盾证据，不足给缺什么；都不处置、不选边。 */
export function renderRelationFindings(findings: RelationFindings): string {
  const lines: string[] = [];
  if (findings.conflicts.length > 0) {
    lines.push("【关系冲突】以下约束逐边核对不通过，留待人工核对，不替律师选边：");
    for (const conflict of findings.conflicts) {
      lines.push(`- (${conflict.kind}) ${conflict.anchors.join(" vs ")}：${conflict.detail}`);
    }
  }
  if (findings.insufficient.length > 0) {
    lines.push("【关系待核】以下约束证据不足，暂不判定：");
    for (const row of findings.insufficient) {
      lines.push(`- (${row.kind}) ${row.anchors.join("、")}：${row.detail}`);
    }
  }
  return lines.join("\n");
}
