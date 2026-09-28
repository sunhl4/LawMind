/**
 * 在办交办册：停在你这里 / 正在办 / 今天办完。
 * 分组是确定性的；签批范围仍走 mergeFleetQueueRows，不另加一道确认。
 */
import type { AgentRunSummary } from "./lawmind-agent-fleet-api";
import type { ActionSummaryPayload } from "./lawmind-requires-action";
import { isFleetSettledVisible } from "../../../../src/lawmind/platform/agent-fleet.ts";
import { collapseFleetRunsByWork } from "./lawmind-fleet-queue";
import { mergeFleetQueueRows } from "./lawmind-fleet-queue-merge";

export type DocketBandId = "needsYou" | "inFlight" | "settled";

export type FleetDocket = {
  needsYou: AgentRunSummary[];
  inFlight: AgentRunSummary[];
  settled: AgentRunSummary[];
};

const IN_FLIGHT_KINDS = new Set<AgentRunSummary["kind"]>([
  "chat",
  "delegation",
  "workflow_job",
]);

const IN_FLIGHT_STATUS = new Set<AgentRunSummary["status"]>([
  "running",
  "queued",
  "scheduled",
]);

const FOLLOW_KINDS = new Set<AgentRunSummary["kind"]>([
  "chat",
  "delegation",
  "workflow_job",
]);

/** 来源说明，不是律师交办的那句话。 */
const PLACEHOLDER_TITLES = new Set(["New Chat", "新对话"]);

const SOURCE_SUBTITLES = new Set([
  "对话 Agent",
  "委派子会话",
  "委派",
  "团队工作流",
  "工作队列",
  "案件审批",
  "交付物待审核",
  "修改后待审核",
  "拟落稿",
  "这场对话",
  "按流程",
  "交给另一位助手",
]);

function workKey(run: AgentRunSummary): string {
  return run.workId?.trim() || run.id;
}

function byUpdatedDesc(a: AgentRunSummary, b: AgentRunSummary): number {
  return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

function needsYouRank(run: AgentRunSummary): number {
  if (run.status === "failed") {
    return 50;
  }
  if (run.status === "interrupted") {
    return 40;
  }
  return run.priority ?? 10;
}

function inFlightRank(run: AgentRunSummary): number {
  if (run.status === "running") {
    return 0;
  }
  if (run.status === "queued") {
    return 1;
  }
  return 2;
}

export function docketBandLabel(id: DocketBandId): string {
  if (id === "needsYou") {
    return "停在你这里";
  }
  if (id === "inFlight") {
    return "正在办";
  }
  return "今天办完";
}

export function docketRowTitle(run: AgentRunSummary, sanitizedTitle: string): string {
  const title = sanitizedTitle.trim();
  if (!PLACEHOLDER_TITLES.has(title)) {
    return title;
  }
  const instruction = docketInstruction(run);
  return instruction || "这场对话";
}

export function docketRowStatusLabel(run: AgentRunSummary): string {
  if (run.kind === "word_check") {
    return "待核对";
  }
  switch (run.status) {
    case "awaiting_review":
      return "待签批";
    case "awaiting_clarification":
      return "待补充";
    case "awaiting_approval":
      return run.kind === "automation_send" ? "待发出" : "待你看过";
    case "interrupted":
      return "已中断";
    case "running":
      return "正在办";
    case "queued":
      return "已排上";
    case "scheduled":
      return "已排期";
    case "completed":
      return "已办完";
    case "failed":
      return "未完成";
    case "cancelled":
      return "已停下";
    default:
      return "待处理";
  }
}

export function docketRowTone(
  run: AgentRunSummary,
): "review" | "clarify" | "approve" | "running" | "failed" | "done" {
  if (run.status === "failed" || run.status === "interrupted") {
    return "failed";
  }
  if (run.status === "completed" || run.status === "cancelled") {
    return "done";
  }
  if (run.status === "running" || run.status === "queued" || run.status === "scheduled") {
    return "running";
  }
  if (run.status === "awaiting_clarification") {
    return "clarify";
  }
  if (run.status === "awaiting_review") {
    return "review";
  }
  return "approve";
}

export function docketSourceLabel(run: AgentRunSummary): string | null {
  if (run.kind === "delegation") {
    return "交给另一位助手";
  }
  if (run.kind === "workflow_job") {
    return "按流程";
  }
  return null;
}

export function docketWhenLabel(iso: string | undefined, now = new Date()): string {
  if (!iso) {
    return "";
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return "";
  }
  const delta = now.getTime() - t;
  if (delta < 0) {
    return "";
  }
  if (delta < 60_000) {
    return "刚刚";
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)} 分钟前`;
  }
  if (delta < 86_400_000) {
    const hours = Math.floor(delta / 3_600_000);
    return hours <= 1 ? "1 小时前" : `${hours} 小时前`;
  }
  return "";
}

export function docketStopLine(run: AgentRunSummary): string {
  const progress = run.progress;
  const step =
    progress && progress.total > 0 ? `已完成 ${progress.completed} / ${progress.total} 步。` : "";
  switch (run.status) {
    case "awaiting_clarification":
      return "办不下去，要你补一句。";
    case "awaiting_review":
      return "稿已经写出。要改修订，打开中间栏。";
    case "interrupted":
      return "办到一半停住了。已完成的步骤还在。";
    case "awaiting_approval":
      return run.kind === "automation_send"
        ? "信已经写好，发出前要你看过。"
        : "这一步要你决定后才能继续。";
    case "running":
      return step ? `正在办。${step}` : "正在办。";
    case "queued":
      return "已排上，还没开始。";
    case "scheduled":
      return "已排期，到点再办。";
    case "completed":
      return run.note?.trim() ? `今天办完了。${run.note.trim()}` : "今天办完了。";
    case "failed":
      return run.note?.trim()
        ? `没有办完。${run.note.trim()}`
        : "没有办完。可以回到这场对话看停在哪里。";
    case "cancelled":
      return "已停下。";
    default:
      return "";
  }
}

function clipInstruction(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length <= 280) {
    return text;
  }
  return `${text.slice(0, 280)}…`;
}

export function docketInstruction(run: AgentRunSummary, userLine?: string): string {
  const goal = run.subtitle?.trim() ?? "";
  const fromGoal = goal.startsWith("本件：") ? goal.slice("本件：".length).trim() : "";
  const fromUser = userLine?.trim() ?? "";
  const fromSubtitle = goal && !SOURCE_SUBTITLES.has(goal) && !goal.startsWith("本件：") ? goal : "";
  const text = clipInstruction(fromGoal || fromUser || fromSubtitle);
  const title = run.title.replace(/^待审定：\s*/, "").replace(/^待批准：\s*/, "").trim();
  if (!text || text === title || text === run.title.trim()) {
    return "";
  }
  return text;
}

export function initialDocketOpen(counts: {
  needsYou: number;
  inFlight: number;
  settled: number;
}): { inFlight: boolean; settled: boolean } {
  const live = counts.needsYou + counts.inFlight > 0;
  return {
    inFlight: counts.inFlight > 0 && counts.inFlight <= 5,
    settled: counts.settled > 0 && !live,
  };
}

export function buildFleetDocket(opts: {
  fleetRuns: AgentRunSummary[] | undefined;
  pendingReviewDrafts: ActionSummaryPayload["pendingReviewDrafts"] | undefined;
  automationInbox: ActionSummaryPayload["automationInbox"] | undefined;
  snoozed: ReadonlySet<string>;
  includePendingReview?: boolean;
  now?: Date;
}): FleetDocket {
  const now = opts.now ?? new Date();
  const fleetRuns = opts.fleetRuns ?? [];
  const decision = mergeFleetQueueRows({
    fleetRuns,
    pendingReviewDrafts: opts.pendingReviewDrafts,
    automationInbox: opts.automationInbox,
    snoozed: opts.snoozed,
    includePendingReview: opts.includePendingReview,
  });
  const seen = new Set(decision.map((run) => run.id));
  const extras: AgentRunSummary[] = [];
  for (const run of fleetRuns) {
    if (seen.has(run.id) || opts.snoozed.has(run.id)) {
      continue;
    }
    if (run.status === "interrupted") {
      extras.push(run);
      seen.add(run.id);
      continue;
    }
    if (
      run.status === "failed" &&
      FOLLOW_KINDS.has(run.kind) &&
      isFleetSettledVisible("failed", run.updatedAt, now)
    ) {
      extras.push(run);
      seen.add(run.id);
    }
  }
  const needsYou = collapseFleetRunsByWork([...decision, ...extras]).toSorted(
    (a, b) => needsYouRank(a) - needsYouRank(b) || byUpdatedDesc(a, b),
  );
  const blocked = new Set<string>();
  const needsYouSessions = new Set<string>();
  for (const run of needsYou) {
    blocked.add(run.id);
    blocked.add(workKey(run));
    const sid = run.sessionId?.trim();
    if (sid) {
      needsYouSessions.add(sid);
    }
  }
  const delegationSessions = new Set<string>();
  for (const run of fleetRuns) {
    if (run.kind !== "delegation") {
      continue;
    }
    const sid = run.sessionId?.trim();
    if (sid) {
      delegationSessions.add(sid);
    }
  }

  const inFlight = collapseFleetRunsByWork(
    fleetRuns.filter((run) => {
      if (opts.snoozed.has(run.id) || blocked.has(run.id) || blocked.has(workKey(run))) {
        return false;
      }
      if (!IN_FLIGHT_KINDS.has(run.kind) || !IN_FLIGHT_STATUS.has(run.status)) {
        return false;
      }
      const sid = run.sessionId?.trim();
      if (!sid) {
        return true;
      }
      // 子会话和委派是同一件。要律师处理时留子会话；还在跑时留委派上的那句话。
      if (run.kind === "chat" && delegationSessions.has(sid)) {
        return false;
      }
      if (run.kind === "delegation" && needsYouSessions.has(sid)) {
        return false;
      }
      return true;
    }),
  ).toSorted((a, b) => inFlightRank(a) - inFlightRank(b) || byUpdatedDesc(a, b));
  for (const run of inFlight) {
    blocked.add(run.id);
    blocked.add(workKey(run));
  }

  const settled = collapseFleetRunsByWork(
    fleetRuns.filter((run) => {
      if (opts.snoozed.has(run.id) || blocked.has(run.id) || blocked.has(workKey(run))) {
        return false;
      }
      if (!FOLLOW_KINDS.has(run.kind)) {
        return false;
      }
      if (run.status !== "completed" && run.status !== "cancelled") {
        return false;
      }
      return isFleetSettledVisible(run.status, run.updatedAt, now);
    }),
  ).toSorted(byUpdatedDesc);

  return { needsYou, inFlight, settled };
}

export function filterDocketByMatter(docket: FleetDocket, matterFilter: string): FleetDocket {
  if (matterFilter === "all") {
    return docket;
  }
  const keep = (run: AgentRunSummary) => (run.matterId?.trim() || "") === matterFilter;
  return {
    needsYou: docket.needsYou.filter(keep),
    inFlight: docket.inFlight.filter(keep),
    settled: docket.settled.filter(keep),
  };
}
