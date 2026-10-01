/**
 * 工作台档案页焦点：从根壳（⌘K 搜索、外发事件、头部案件 chip）跳进某一卷时，
 * 携带目标区块，让档案页打开后直接滚到对应位置。
 *
 * - `docs`：现在（待发出 / 未回 / 期限）——外发深链的默认落点
 * - `volume`：卷（来件 / 我们写的 / 其余）
 * - `deadlines`：底 → 全部期限（会自动展开收起的档案）
 */
export type DeskMatterFocusPane = "docs" | "volume" | "deadlines";

export type DeskMatterFocus = {
  id: string;
  n: number;
  pane?: DeskMatterFocusPane;
} | null;

/** 档案页各 pane 对应的 DOM 锚点。 */
export function deskMatterPaneSelector(pane: DeskMatterFocusPane): string {
  if (pane === "volume") {
    return '[id="lm-matter-volume"]';
  }
  if (pane === "deadlines") {
    return '[id="lm-lawyer-pane-deadlines"]';
  }
  return '[data-testid="lm-matter-now"]';
}

/** 案卷列表「最热一行」点进去应落在哪一块；无则只打开该案。 */
export function matterHotPaneTarget(input: {
  overdueDeadline: boolean;
  outboundCount: number;
  unreplied: boolean;
  daysUntilDeadline?: number | null;
}): DeskMatterFocusPane | undefined {
  if (input.overdueDeadline) {
    return "deadlines";
  }
  if (typeof input.daysUntilDeadline === "number" && input.daysUntilDeadline <= 7) {
    return "deadlines";
  }
  if (input.outboundCount > 0 || input.unreplied) {
    return "docs";
  }
  return undefined;
}
