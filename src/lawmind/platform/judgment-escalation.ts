/**
 * G3：判断项升级通道 —— 把「被移出提示词的主观项」变成律师可见的待定夺卡。
 *
 * ## 为什么这条通路必须存在
 *
 * 判据分级把检查单项分成 machine / judge / lawyer。`lawyer` 项的定义是
 * **「不判，只升级」**（`LAWMIND-LEGAL-COMPILER-ROADMAP.md` §2.3：主观裁量项永不编译）。
 *
 * 但"只升级"要有**升级的去处**。如果升级卡不存在就把 lawyer 项从提示词里摘掉，
 * 这些项会**既不被任何判定器判、也不出现在任何卡片上**——安静地消失。
 * 那比继续问模型更糟，因为主观裁量恰恰是最需要律师看见的那一批。
 *
 * 所以 `policy/judgment-tiering.ts` 的 `isLawyerEscalationAvailable()` **默认 false**：
 * 通道没接通时主观项继续由模型判。本模块就是那个"接通"的实现。
 *
 * ## 文案纪律
 *
 * 进律师可见面的只有 `label`（该项要看什么）与 `reason`（为什么必须由人判）。
 * **`itemKey` 是内部 id，绝不出现在卡片文案里**——`ui-copy-lint` 会拦。
 */

import type { JudgmentEscalationItem } from "../guardian/judgment-tier.js";
import { readLatestGuardian } from "../guardian/store.js";
import { buildJudgmentEscalationAction } from "./requires-action.js";
import type { LawMindRequiresAction } from "./requires-action.js";

export type JudgmentEscalationReadResult = {
  /** 是否有可展示的待定夺项。 */
  present: boolean;
  items: JudgmentEscalationItem[];
  /** 覆盖自述（诚实呈现，I12）。 */
  coverageNote?: string;
};

/**
 * 读出某任务最近的待定夺项。
 *
 * 来源是 Guardian sidecar（`drafts/<taskId>.guardian.json`）的 `escalationItems`——
 * 那是 `runLegalGuardian` 在把 lawyer 项移出提示词时如实登记的。
 *
 * **逾期不猜**：读不到（无 sidecar / 无该字段 / 解析失败）一律返回 `present: false`，
 * 不返回空数组假装"没有待定夺项"——两者的含义完全不同。
 */
export function readJudgmentEscalation(
  workspaceDir: string,
  taskId: string,
): JudgmentEscalationReadResult {
  const record = readLatestGuardian(workspaceDir, taskId);
  const rows = (record?.escalationItems ?? []).filter(
    (i) => i.label.trim().length > 0 && i.itemKey.trim().length > 0,
  );
  if (rows.length === 0) {
    return { present: false, items: [] };
  }
  return {
    present: true,
    items: rows.map((i) => ({
      itemKey: i.itemKey,
      label: i.label,
      reason: i.reason,
    })),
  };
}

/**
 * 构造待定夺卡。
 *
 * 返回 `undefined` 表示**没有可升级项**——调用方应理解为"本件无需因此打断律师"，
 * 而不是"通道坏了"。通道是否可用由 `isLawyerEscalationAvailable()` 决定。
 */
export function buildJudgmentEscalationForTask(input: {
  workspaceDir: string;
  taskId: string;
  sessionId: string;
  matterId?: string;
  /** 本次机械核对覆盖自述（如「本次机械核对 12 项」）。 */
  coverageNote?: string;
}): LawMindRequiresAction | undefined {
  const read = readJudgmentEscalation(input.workspaceDir, input.taskId);
  if (!read.present) {
    return undefined;
  }
  return buildJudgmentEscalationAction({
    sessionId: input.sessionId,
    taskId: input.taskId,
    ...(input.matterId ? { matterId: input.matterId } : {}),
    items: read.items.map((i) => ({ label: i.label, why: i.reason })),
    ...(input.coverageNote ? { coverageNote: input.coverageNote } : {}),
  });
}

/**
 * 覆盖自述文案（诚实呈现硬约束，I12）。
 *
 * 口径来自 `lint/types.ts`：**通过 ≠ 法律正确**。所以这里自述的是
 * 「本次核对了多少项、其中多少项由机器判」，而**不是**任何形式的"正确率"。
 */
export function formatJudgmentCoverageNote(input: {
  checkedTotal: number;
  machineCount: number;
  escalatedCount: number;
}): string {
  const parts = [`本次机械核对 ${input.checkedTotal} 项`];
  if (input.machineCount > 0) {
    parts.push(`其中 ${input.machineCount} 项由确定性规则判定`);
  }
  if (input.escalatedCount > 0) {
    parts.push(`${input.escalatedCount} 项需您定夺`);
  }
  return `${parts.join("，")}。通过核对 ≠ 法律正确。`;
}
