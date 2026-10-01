/**
 * 助手名册的摆放规则：置顶、隐藏、上限。
 *
 * 隐藏只影响顶栏日常切换。名册（设置里的编制）仍然看得到，
 * 否则律师会以为助手和它办过的事一起没了。
 */

import { DEFAULT_ASSISTANT_ID } from "./constants.js";

/** 与策略里「名册要有上限」对齐：再多就开始互相抢注意力。 */
export const ASSISTANT_ROSTER_LIMIT = 50;

/** Solo / 未开 multiAssistantRoster：只允许一位父助手。 */
export const SOLO_ASSISTANT_ROSTER_LIMIT = 1;

export const SOLO_ROSTER_FULL_MESSAGE =
  "独立律师版只需一位父助手。复杂活请在对话里用子工并行；律所协作版才可编制多名助手。";

export type AssistantRosterFlags = {
  assistantId: string;
  displayName: string;
  pinned?: boolean;
  hidden?: boolean;
};

export function assertAssistantRosterHasRoom(count: number): void {
  if (count >= ASSISTANT_ROSTER_LIMIT) {
    throw new Error(
      `助手名册已满（最多 ${ASSISTANT_ROSTER_LIMIT} 位）。请先删掉不再用的助手，再新建。`,
    );
  }
}

/** Create/duplicate gate. Updates to an existing id must not call this. */
export function assertCanCreateAssistant(count: number, allowMultiRoster: boolean): void {
  if (!allowMultiRoster && count >= SOLO_ASSISTANT_ROSTER_LIMIT) {
    throw new Error(SOLO_ROSTER_FULL_MESSAGE);
  }
  assertAssistantRosterHasRoom(count);
}

/** 落盘前把非 true 收成缺省，并禁止默认助手处于隐藏。 */
export function normalizeAssistantRosterFlags<T extends AssistantRosterFlags>(profile: T): T {
  const pinned = profile.pinned === true ? true : undefined;
  const hidden =
    profile.hidden === true && profile.assistantId !== DEFAULT_ASSISTANT_ID ? true : undefined;
  return { ...profile, pinned, hidden };
}

export function assistantJobBriefHint(brief: { prohibitions?: string } | undefined): string {
  return brief?.prohibitions?.trim() ? "职务说明书已写" : "还没写禁止项";
}

function rosterRank(row: AssistantRosterFlags): number {
  if (row.pinned === true && row.hidden !== true) {
    return 0;
  }
  if (row.hidden === true) {
    return 2;
  }
  return 1;
}

/** 置顶在前，隐藏在后，同组按名字。 */
export function sortAssistantsForRoster<T extends AssistantRosterFlags>(rows: readonly T[]): T[] {
  return [...rows].toSorted((a, b) => {
    const rank = rosterRank(a) - rosterRank(b);
    if (rank !== 0) {
      return rank;
    }
    return a.displayName.localeCompare(b.displayName, "zh");
  });
}

/**
 * 顶栏日常切换：隐藏的不出现。
 * 当前正在用的那一位即使被隐藏也留在列表里，避免下拉框对不上已选值。
 */
export function assistantsForDailySwitcher<T extends AssistantRosterFlags>(
  rows: readonly T[],
  selectedId: string,
): T[] {
  return sortAssistantsForRoster(
    rows.filter((row) => row.hidden !== true || row.assistantId === selectedId),
  );
}
