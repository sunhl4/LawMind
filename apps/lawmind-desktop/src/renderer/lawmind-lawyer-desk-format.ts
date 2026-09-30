/**
 * 工作台纯展示口径（日期、期限、今日条目排序）。
 * 从 LawmindLawyerWorkbench 拆出，避免主文件继续涨。
 */

import { DEADLINE_SOURCE_LABELS } from "../../../../src/lawmind/desk/deadline-chain.ts";
import { LEGAL_EVENT_KIND_LABELS } from "../../../../src/lawmind/desk/legal-event-extract.ts";

export type DeskTodayKind = "plan" | "mail" | "deadline" | "approval";

export type DeskTodayItem = {
  id: string;
  kind: DeskTodayKind;
  done: boolean;
  dueAt?: string;
  originDate?: string;
  sourceRef?: string;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatDeskDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map((part) => Number(part));
  if (!y || !m || !d) {
    return isoDate;
  }
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 周${WEEKDAYS[dt.getDay()]}`;
}

export function formatDueShort(dueAt?: string): string {
  if (!dueAt) {
    return "";
  }
  return dueAt.slice(0, 16).replace("T", " ");
}

export function formatClock(dueAt?: string): string {
  if (!dueAt) {
    return "全天";
  }
  const clock = dueAt.slice(11, 16);
  if (clock && clock !== "00:00") {
    return clock;
  }
  return dueAt.slice(5, 10);
}

export function isOverdue(dueAt: string | undefined, now = new Date()): boolean {
  if (!dueAt) {
    return false;
  }
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return false;
  }
  return due.getTime() < now.getTime();
}

export function countKind(items: DeskTodayItem[], kind: DeskTodayKind, openOnly = false): number {
  return items.filter((item) => item.kind === kind && (!openOnly || !item.done)).length;
}

export function isCarriedPlan(item: DeskTodayItem, todayDate: string | undefined): boolean {
  return item.kind === "plan" && Boolean(item.originDate) && item.originDate !== todayDate;
}

export function formatMonthDay(dateKey: string): string {
  const parts = dateKey.split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!month || !day) {
    return dateKey;
  }
  return `${month}月${day}日`;
}

export function planCardMeta(item: DeskTodayItem, todayDate: string | undefined): string {
  if (isCarriedPlan(item, todayDate) && item.originDate) {
    return `未结 · 自 ${formatMonthDay(item.originDate)}`;
  }
  return "今日计划，勾完计入进度";
}

export function actionSortRank(item: DeskTodayItem, todayDate: string | undefined): number {
  if (item.kind === "approval") {
    return 0;
  }
  if (item.kind === "mail") {
    return 1;
  }
  if (isCarriedPlan(item, todayDate)) {
    return 2;
  }
  if (item.kind === "plan") {
    return 3;
  }
  return 4;
}

export function eventKindLabel(eventKind: string | undefined): string {
  if (!eventKind) {
    return "期限";
  }
  return LEGAL_EVENT_KIND_LABELS[eventKind as keyof typeof LEGAL_EVENT_KIND_LABELS] ?? eventKind;
}

export function deadlineSourceCopy(row: { source?: string; sourceLabel?: string }): string {
  if (row.sourceLabel?.trim()) {
    return row.sourceLabel.trim();
  }
  if (!row.source) {
    return "";
  }
  return DEADLINE_SOURCE_LABELS[row.source as keyof typeof DEADLINE_SOURCE_LABELS] ?? "";
}

export function matterStatusZh(status: string | undefined): string {
  if (!status) {
    return "未标";
  }
  const labels: Record<string, string> = {
    intake: "收案",
    active: "进行中",
    open: "进行中",
    waiting_on_client: "等客户",
    waiting_on_firm: "等所内",
    under_review: "审查中",
    delivered: "已交付",
    closed: "已结",
  };
  return labels[status] ?? status;
}

export function hearingCountdown(days: number | null | undefined): string | null {
  if (days === null || days === undefined) {
    return null;
  }
  if (days < 0) {
    return `开庭已过 ${-days} 天`;
  }
  if (days === 0) {
    return "今天开庭";
  }
  if (days === 1) {
    return "明天开庭";
  }
  if (days === 2) {
    return "后天开庭";
  }
  return `还有 ${days} 天开庭`;
}

/** 案卷列表顶上可点的过滤。点一下只滤列表，不再另开一栏。 */
export type DeskListFilter = "all" | "outbound" | "overdue" | "unreplied";

export type MatterUrgencyInput = {
  status?: string;
  daysUntilHearing?: number | null;
  outboundCount: number;
  unreplied: boolean;
  overdueDeadline: boolean;
  /** 未过期、且在 7 天内的最近一条期限。 */
  daysUntilDeadline?: number | null;
};

/** 一行案子只留最热的一件事。没有这些，调用方就只显示案名。 */
export function matterHotLine(input: MatterUrgencyInput): string | null {
  if (input.overdueDeadline) {
    return "期限已过";
  }
  if (input.outboundCount === 1) {
    return "有一封待发出";
  }
  if (input.outboundCount > 1) {
    return `${input.outboundCount} 封待发出`;
  }
  if (input.unreplied) {
    return "有来信未回";
  }
  if (typeof input.daysUntilHearing === "number" && input.daysUntilHearing <= 7) {
    return hearingCountdown(input.daysUntilHearing);
  }
  const due = input.daysUntilDeadline;
  if (typeof due === "number" && due >= 0 && due <= 7) {
    if (due === 0) {
      return "今天到期";
    }
    if (due === 1) {
      return "明天到期";
    }
    if (due === 2) {
      return "后天到期";
    }
    return `还有 ${due} 天到期`;
  }
  return null;
}

/** 越小越靠前。已结案沉底。 */
export function urgencyListRank(input: MatterUrgencyInput): number {
  if (input.status === "closed" || input.status === "delivered") {
    return 800;
  }
  if (input.overdueDeadline) {
    return 0;
  }
  if (input.outboundCount > 0) {
    return 10;
  }
  if (input.unreplied) {
    return 20;
  }
  if (typeof input.daysUntilHearing === "number" && input.daysUntilHearing <= 7) {
    return 30 + Math.max(0, input.daysUntilHearing);
  }
  const due = input.daysUntilDeadline;
  if (typeof due === "number" && due >= 0 && due <= 7) {
    return 50 + due;
  }
  return 120;
}

export function matterMatchesListFilter(
  filter: DeskListFilter,
  input: Pick<MatterUrgencyInput, "outboundCount" | "unreplied" | "overdueDeadline">,
): boolean {
  if (filter === "outbound") {
    return input.outboundCount > 0;
  }
  if (filter === "overdue") {
    return input.overdueDeadline;
  }
  if (filter === "unreplied") {
    return input.unreplied;
  }
  return true;
}

export function formatTimelineDay(at: string): string {
  const stamp = at.trim();
  if (!stamp) {
    return "";
  }
  const dt = new Date(stamp);
  if (!Number.isNaN(dt.getTime())) {
    return `${dt.getMonth() + 1}月${dt.getDate()}日`;
  }
  const md = stamp.slice(5, 10);
  if (/^\d{2}-\d{2}$/.test(md)) {
    return `${Number(md.slice(0, 2))}月${Number(md.slice(3))}日`;
  }
  return stamp.slice(0, 10);
}

export function formatMaterialBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function materialDisplayPath(relPath: string): string {
  return relPath.replace(/^materials\//, "");
}

export function mailSourceRef(item: Pick<DeskTodayItem, "id" | "sourceRef">): string | undefined {
  const explicit = item.sourceRef?.trim();
  if (explicit) {
    return explicit;
  }
  const tail = item.id.replace(/^mail:/, "");
  const colon = tail.lastIndexOf(":");
  return (colon >= 0 ? tail.slice(colon + 1) : tail).trim() || undefined;
}
