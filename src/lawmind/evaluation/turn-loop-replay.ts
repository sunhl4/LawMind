/**
 * Turn-loop replay metrics — quality evidence, not admission tests.
 *
 * Cassettes (`turn-orchestrator-cassettes.test.ts`) prove the mechanism still
 * works on scripted model bytes. This module answers a different question over
 * **real persisted turns**:
 *
 *   - completion rate
 *   - stop-reason distribution
 *   - average rounds / tool calls
 *   - convergence after a verify / deferral bounce
 *
 * Input is `<workspace>/sessions/*.turns.jsonl` — the same rows the desktop
 * appends at turn finalization. No fixtures, no synthetic model bytes.
 *
 * Honesty rule: with no real turns the CLI prints SKIP. Do not treat a
 * synthetic corpus as product evidence.
 */

import fs from "node:fs";
import path from "node:path";
import {
  stopReasonBucket,
  type TurnStopBucket,
  type TurnStopReason,
} from "../agent/turn-loop-state.js";
import type { AgentTurn } from "../agent/types.js";

export type TurnReplayRow = {
  sessionId: string;
  turnId: string;
  status: string;
  stopReason: TurnStopReason;
  /** `recorded`: the loop wrote it. `derived`: legacy row, inferred from status. */
  stopReasonSource: "recorded" | "derived";
  bucket: TurnStopBucket;
  profileId?: string;
  /** Loop rounds (`AgentTurn.roundCount`). Legacy rows fall back to assistant rows. */
  rounds: number;
  roundsSource: "recorded" | "assistant_fallback";
  toolCalls: number;
  verifyBounces: number;
  deferralBounces: number;
  durationMs?: number;
  instructionChars: number;
  startedAt?: string;
};

export type TurnReplayFetchOpts = {
  /** Keep turns started at/after this instant. */
  since?: string | Date;
  /** Restrict to these session ids. */
  sessionIds?: readonly string[];
};

/** One afternoon benchmark run writes many per-task workspaces (`case-10/sessions/...`). */
export type TurnReplayScanOpts = {
  /** How many directory levels below the root to look for `sessions/`. Default 3. */
  maxDepth?: number;
  /** Hard stop so a stray root cannot walk the whole disk. */
  maxDirs?: number;
};

function parseTime(value: string | Date | undefined): number | undefined {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (!value) {
    return undefined;
  }
  // Date-only means local midnight (the CLI/README speak the lawyer's day),
  // not UTC midnight. A full ISO timestamp is parsed as given.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)).getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Legacy turns predate `stopReason`; derive the closest honest cause. */
export function deriveStopReason(turn: AgentTurn): TurnStopReason {
  if (turn.stopReason) {
    return turn.stopReason;
  }
  if (turn.error === "aborted_by_user") {
    return "aborted";
  }
  switch (turn.status) {
    case "completed":
      return "delivered";
    case "awaiting_approval":
      return "awaiting_approval";
    case "awaiting_clarification":
      return "awaiting_clarification";
    case "paused":
      return "aborted";
    case "error":
      return "model_error";
    default:
      return "unknown";
  }
}

function roundsFromTurn(turn: AgentTurn): {
  rounds: number;
  roundsSource: "recorded" | "assistant_fallback";
} {
  if (typeof turn.roundCount === "number" && Number.isFinite(turn.roundCount)) {
    return { rounds: Math.max(0, Math.floor(turn.roundCount)), roundsSource: "recorded" };
  }
  // Legacy fallback: one assistant message per model sample (tool calls included).
  return {
    rounds: turn.messages.filter((message) => message.role === "assistant").length,
    roundsSource: "assistant_fallback",
  };
}

export function turnReplayRow(turn: AgentTurn): TurnReplayRow {
  const stopReason = deriveStopReason(turn);
  const { rounds, roundsSource } = roundsFromTurn(turn);
  const started = parseTime(turn.startedAt);
  const completed = parseTime(turn.completedAt);
  const durationMs =
    started !== undefined && completed !== undefined && completed >= started
      ? completed - started
      : undefined;
  return {
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    status: turn.status,
    stopReason,
    stopReasonSource: turn.stopReason ? "recorded" : "derived",
    bucket: stopReasonBucket(stopReason),
    ...(turn.profileId ? { profileId: turn.profileId } : {}),
    rounds,
    roundsSource,
    toolCalls: Math.max(0, Math.floor(turn.toolCallsExecuted || 0)),
    verifyBounces: Math.max(0, Math.floor(turn.sameTurnVerify?.bounceCount ?? 0)),
    deferralBounces: Math.max(0, Math.floor(turn.contextDeferralBounces ?? 0)),
    ...(durationMs !== undefined ? { durationMs } : {}),
    instructionChars: turn.instruction?.length ?? 0,
    ...(turn.startedAt ? { startedAt: turn.startedAt } : {}),
  };
}

function listTurnFiles(workspaceDir: string): string[] {
  const sessionsDir = path.join(workspaceDir, "sessions");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".turns.jsonl"))
    .map((name) => path.join(sessionsDir, name))
    .toSorted();
}

function readTurnFile(filePath: string): AgentTurn[] {
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const turns: AgentTurn[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as AgentTurn;
      if (parsed && typeof parsed.turnId === "string") {
        turns.push(parsed);
      }
    } catch {
      /* skip a torn line; one bad row must not hide the rest */
    }
  }
  return turns;
}

/**
 * Find every directory at or below `root` that has a `sessions/` folder.
 * Benchmark runners write one workspace per task, so a single `--workspace`
 * at the run root must still see all of them.
 */
export function discoverTurnWorkspaces(root: string, opts: TurnReplayScanOpts = {}): string[] {
  const maxDepth = Math.max(0, opts.maxDepth ?? 3);
  const maxDirs = Math.max(1, opts.maxDirs ?? 2_000);
  const found: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: path.resolve(root), depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < maxDirs) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    visited += 1;
    if (fs.existsSync(path.join(next.dir, "sessions"))) {
      found.push(next.dir);
      // Keep descending: a run root can have its own sessions/ **and** one
      // per-task workspace (`case-10/sessions/...`). Pruning here hid them.
    }
    if (next.depth >= maxDepth) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(next.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      queue.push({ dir: path.join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }
  return found.toSorted();
}

/**
 * Read every persisted turn under `<workspaceDir>/sessions/*.turns.jsonl`.
 * Last row wins for a duplicate `turnId` (finalize appends once, but a crash
 * and resume can leave an earlier placeholder in the same file).
 */
export function collectTurnReplayRows(
  workspaceDir: string | readonly string[],
  opts: TurnReplayFetchOpts = {},
): TurnReplayRow[] {
  const sinceMs = parseTime(opts.since);
  const allowed = opts.sessionIds ? new Set(opts.sessionIds) : undefined;
  const byId = new Map<string, TurnReplayRow>();
  const roots = typeof workspaceDir === "string" ? [workspaceDir] : workspaceDir;

  for (const root of roots) {
    for (const filePath of listTurnFiles(root)) {
      for (const turn of readTurnFile(filePath)) {
        if (allowed && !allowed.has(turn.sessionId)) {
          continue;
        }
        if (sinceMs !== undefined) {
          const started = parseTime(turn.startedAt);
          if (started === undefined || started < sinceMs) {
            continue;
          }
        }
        const row = turnReplayRow(turn);
        // Session ids are often reused across benchmark task workspaces; the
        // workspace root must be part of the identity.
        byId.set(`${path.resolve(root)}\u0000${row.sessionId}\u0000${row.turnId}`, row);
      }
    }
  }

  return [...byId.values()].toSorted((a, b) => {
    const at = a.startedAt ? Date.parse(a.startedAt) : 0;
    const bt = b.startedAt ? Date.parse(b.startedAt) : 0;
    return at - bt;
  });
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type TurnProfileRollup = {
  profileId: string;
  total: number;
  /** Exactly `stopReason === "delivered"` within this profile. */
  cleanDeliveryRate: number;
  avgRounds: number;
  avgToolCalls: number;
};

export type TurnReplaySummary = {
  total: number;
  /** Bucket `delivered` — includes clarification deliveries and prose-note closes. */
  delivered: number;
  /** @deprecated Use {@link cleanDelivered} / {@link loopCleanDeliveryRate}. */
  completionRate: number;
  /**
   * Exactly `stopReason === "delivered"` on rows that recorded a cause: no
   * gaps, no shortcut, no note. Legacy rows never count as clean here.
   */
  cleanDelivered: number;
  /** Denominator is {@link recordedRows}, not all rows. */
  cleanDeliveryRate: number;
  /** Rows with a recorded cause and `rounds > 0`. */
  loopRows: number;
  loopCleanDeliveryRate: number;
  /** Rows written before `stopReason` existed; causes were inferred from status. */
  legacyRows: number;
  /** Rows with a recorded `stopReason` (the denominator for clean rates). */
  recordedRows: number;
  /** Rows whose round count came from the legacy assistant-message fallback. */
  legacyRoundRows: number;
  /** Clean-delivery rate over rows that actually recorded a stop cause. */
  completionRateRecorded: number;
  buckets: Record<TurnStopBucket, number>;
  stopReasons: Array<{ reason: TurnStopReason; count: number }>;
  avgRounds: number;
  p50Rounds: number;
  p95Rounds: number;
  avgToolCalls: number;
  p50ToolCalls: number;
  p95ToolCalls: number;
  /** Turns that used at least one verify / deferral bounce. */
  bounceTurns: number;
  /** Bounce turns that still ended as a clean delivery. */
  bounceConvergenceRate: number;
  avgDurationMs?: number;
  p95DurationMs?: number;
  byProfile: TurnProfileRollup[];
};

const EMPTY_BUCKETS: Record<TurnStopBucket, number> = {
  delivered: 0,
  needs_lawyer: 0,
  budget: 0,
  loop_guard: 0,
  model_error: 0,
  aborted: 0,
  unknown: 0,
};

export function summarizeTurnReplay(rows: readonly TurnReplayRow[]): TurnReplaySummary {
  const total = rows.length;
  const buckets = { ...EMPTY_BUCKETS };
  const reasonCounts = new Map<TurnStopReason, number>();
  const rounds = rows.map((row) => row.rounds);
  const tools = rows.map((row) => row.toolCalls);
  const durations = rows
    .map((row) => row.durationMs)
    .filter((value): value is number => typeof value === "number");

  for (const row of rows) {
    buckets[row.bucket] += 1;
    reasonCounts.set(row.stopReason, (reasonCounts.get(row.stopReason) ?? 0) + 1);
  }

  const bounceRows = rows.filter((row) => row.verifyBounces > 0 || row.deferralBounces > 0);
  const converged = bounceRows.filter((row) => row.stopReason === "delivered").length;
  const recorded = rows.filter((row) => row.stopReasonSource === "recorded");
  const legacyRows = rows.length - recorded.length;
  const recordedClean = recorded.filter((row) => row.stopReason === "delivered").length;
  const cleanDelivered = recordedClean;
  const loopRows = recorded.filter((row) => row.rounds > 0);
  const loopClean = loopRows.filter((row) => row.stopReason === "delivered").length;
  const legacyRoundRows = rows.filter((row) => row.roundsSource === "assistant_fallback").length;

  const profiles = new Map<string, TurnReplayRow[]>();
  for (const row of rows) {
    const key = row.profileId ?? "unknown";
    const bucket = profiles.get(key) ?? [];
    bucket.push(row);
    profiles.set(key, bucket);
  }
  const byProfile = [...profiles.entries()]
    .map(([profileId, profileRows]) => ({
      profileId,
      total: profileRows.length,
      cleanDeliveryRate:
        profileRows.length === 0
          ? 0
          : profileRows.filter((row) => row.stopReason === "delivered").length / profileRows.length,
      avgRounds: mean(profileRows.map((row) => row.rounds)),
      avgToolCalls: mean(profileRows.map((row) => row.toolCalls)),
    }))
    .toSorted((a, b) => b.total - a.total);

  return {
    total,
    delivered: buckets.delivered,
    completionRate: total === 0 ? 0 : buckets.delivered / total,
    cleanDelivered,
    cleanDeliveryRate: recorded.length === 0 ? 0 : cleanDelivered / recorded.length,
    loopRows: loopRows.length,
    loopCleanDeliveryRate: loopRows.length === 0 ? 0 : loopClean / loopRows.length,
    legacyRows,
    recordedRows: recorded.length,
    legacyRoundRows,
    completionRateRecorded: recorded.length === 0 ? 0 : recordedClean / recorded.length,
    buckets,
    stopReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .toSorted((a, b) => b.count - a.count),
    avgRounds: mean(rounds),
    p50Rounds: percentile(rounds, 50),
    p95Rounds: percentile(rounds, 95),
    avgToolCalls: mean(tools),
    p50ToolCalls: percentile(tools, 50),
    p95ToolCalls: percentile(tools, 95),
    bounceTurns: bounceRows.length,
    bounceConvergenceRate: bounceRows.length === 0 ? 0 : converged / bounceRows.length,
    ...(durations.length > 0
      ? { avgDurationMs: mean(durations), p95DurationMs: percentile(durations, 95) }
      : {}),
    byProfile,
  };
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** Markdown one-pager for `scripts/lawmind/lawmind-turn-replay.ts`. */
export function buildTurnReplayReportMarkdown(summary: TurnReplaySummary): string {
  const lines: string[] = [
    "# Agent 回合回放",
    "",
    `- 回合数：${summary.total}`,
    `- 干净交付（有明确停因的回合）：${summary.cleanDelivered}/${summary.recordedRows}（${pct(summary.cleanDeliveryRate)}）`,
    `- 模型循环（有停因且有轮次）：${summary.loopRows} 个，干净交付率 ${pct(summary.loopCleanDeliveryRate)}`,
    `- 轮数：均值 ${num(summary.avgRounds)}，p50 ${num(summary.p50Rounds)}，p95 ${num(summary.p95Rounds)}`,
    `- 工具调用：均值 ${num(summary.avgToolCalls)}，p50 ${num(summary.p50ToolCalls)}，p95 ${num(summary.p95ToolCalls)}`,
  ];
  if (summary.legacyRows > 0) {
    lines.push(
      `- 有明确停因的回合：${summary.total - summary.legacyRows}（干净交付率 ${pct(summary.completionRateRecorded)}）；` +
        `${summary.legacyRows} 行是历史回合，停因只能按 status 推断（不等于真实停因分布）`,
    );
  }
  if (summary.avgDurationMs !== undefined) {
    lines.push(
      `- 时长：均值 ${num(summary.avgDurationMs)}ms，p95 ${num(summary.p95DurationMs ?? 0)}ms`,
    );
  }
  if (summary.legacyRoundRows > 0) {
    lines.push(
      `- 轮数口径：${summary.legacyRoundRows} 行无 roundCount，用 assistant 条数回退计数（均值会被抬高）`,
    );
  }
  lines.push(
    `- 反弹收敛：${summary.bounceTurns} 个回合用过反弹，收敛率 ${pct(summary.bounceConvergenceRate)}`,
    "",
    "## 停因分布",
    "",
    "| 停因 | 次数 |",
    "| --- | --- |",
  );
  for (const row of summary.stopReasons) {
    lines.push(`| ${row.reason} | ${row.count} |`);
  }
  lines.push(
    "",
    "## 按交付形态",
    "",
    "| profile | 回合 | 交付率 | 均轮数 | 均工具 |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const row of summary.byProfile) {
    lines.push(
      `| ${row.profileId} | ${row.total} | ${pct(row.cleanDeliveryRate)} | ${num(row.avgRounds)} | ${num(row.avgToolCalls)} |`,
    );
  }
  lines.push(
    "",
    "> 数据来自本机真实回合（`sessions/*.turns.jsonl`）。没有行时脚本打印 SKIP，不拿夹具冒充现场证据。",
  );
  return `${lines.join("\n")}\n`;
}
