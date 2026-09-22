/**
 * Codex 对齐 · 中断轮次（interrupted turn）。
 *
 * 背景（真实事故）：桌面在改稿回合中途退出/被杀，`session.json` 里留下了那一轮的
 * 指令与工具结果，但**没有 turn 记录**（`session.turns.push` 只在收尾时发生）。
 * 于是下一句 `k` 被当成全新指令，模型顺着历史里的旧指令把整条流水线重跑。
 *
 * 对齐方式：回合开始就把占位轮次落盘（status running），读取时若**没有任何活着
 * 的回合**持有它，就把它呈现为 `interrupted`，并派生一张「继续本件 / 弃办」卡片
 * （复用既有 `continue_tools` 恢复通道），不再让律师靠猜。
 *
 * 关键取舍：派生而不是改写。中断判定是**读时视图**——除了回合开始的占位写，
 * 不在读路径上改写会话文件，避免与在跑回合的 `saveSession` 抢写。
 */

import type { TaskExecutionState } from "../platform/contracts.js";
import type { LawMindRequiresAction } from "../platform/requires-action.js";
import { buildContinueToolsAction } from "../platform/requires-action.js";
import { getLiveTurnProgress } from "./live-turn-progress.js";
import { isSessionTurnLeaseLive } from "./session-turn-gate.js";
import type { AgentSession, AgentTurn } from "./types.js";

/** 派生卡片的 id 前缀：`interrupted:<turnId>`，跨请求稳定（resume 靠它找回动作）。 */
export const INTERRUPTED_ACTION_PREFIX = "interrupted:";

/**
 * 刚起步的回合不判中断：进程可能正在起 live 进度 / 写占位轮次之间。
 * 60s 之外仍 `running` 且无活性才认定为中断。
 */
export const INTERRUPTED_TURN_GRACE_MS = 60_000;

export function isSessionTurnLive(
  workspaceDir: string,
  sessionId: string,
  nowMs: number = Date.now(),
): boolean {
  if (getLiveTurnProgress(sessionId)?.status === "running") {
    return true;
  }
  // 同进程租约不算活：恢复入口自己会先拿租约，真实在跑由 live progress 作真相源。
  return isSessionTurnLeaseLive(workspaceDir, sessionId, nowMs, { ignoreOwnPid: true });
}

export type InterruptedTurnInput = Pick<AgentTurn, "status" | "startedAt">;

/** 是否把这一轮呈现为中断（占位仍 running、无活回合、已过宽限期）。 */
export function isInterruptedTurnView(input: InterruptedTurnInput): boolean {
  if (input.status !== "running") {
    return false;
  }
  const started = Date.parse(input.startedAt);
  if (!Number.isFinite(started)) {
    return true;
  }
  return Date.now() - started > INTERRUPTED_TURN_GRACE_MS;
}

export function interruptedTurnExecutionState(turn: InterruptedTurnInput): TaskExecutionState {
  return {
    phase: "approval",
    status: "awaiting_approval",
    recoverable: true,
    detail: `上一轮被中断（${formatInterruptedAt(turn.startedAt)}），已办理的步骤保留，等您决定是否继续本件。`,
  };
}

function formatInterruptedAt(startedAt: string): string {
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) {
    return "上次退出前";
  }
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 律师面说明：本件停在哪、为什么停。 */
export function formatInterruptedTurnNote(turn: InterruptedTurnInput): string {
  return [
    `上一轮在办理中途被中断（${formatInterruptedAt(turn.startedAt)}，应用退出或回合未收口）。`,
    "已完成的步骤与材料都保留着。要继续本件就点「继续本件」；不办了就点「弃办」。",
  ].join("\n");
}

/** 派生「继续本件 / 弃办」卡片（复用既有 continue_tools 恢复通道）。 */
export function buildInterruptedTurnAction(input: {
  sessionId: string;
  turnId: string;
  instruction?: string;
  used?: number;
  matterId?: string;
}): LawMindRequiresAction {
  const base = buildContinueToolsAction({
    sessionId: input.sessionId,
    matterId: input.matterId,
    taskId: input.turnId,
    used: input.used,
  });
  return {
    ...base,
    id: `${INTERRUPTED_ACTION_PREFIX}${input.turnId}`,
    title: "上一轮被中断",
    summary: "已办理的步骤保留。继续本件，还是先弃办？",
    trigger: "interrupted",
    ...(input.instruction?.trim() ? { instruction: input.instruction.trim() } : {}),
  };
}

export function isInterruptedTurnAction(action: LawMindRequiresAction): boolean {
  return action.kind === "continue_tools" && action.trigger === "interrupted";
}

export function isInterruptedActionId(actionId: string): boolean {
  return actionId.startsWith(INTERRUPTED_ACTION_PREFIX);
}

/**
 * 只读视图：把「无活回合却仍 running」的轮次呈现为 interrupted。
 * 不改磁盘；调用方自行决定是否把派生动作落盘。
 */
export function viewTurnsForLawyer(session: AgentSession, live: boolean): AgentTurn[] {
  if (live) {
    return session.turns;
  }
  return session.turns.map((turn) => {
    if (!isInterruptedTurnView(turn)) {
      return turn;
    }
    return {
      ...turn,
      status: "interrupted" as const,
      executionState: interruptedTurnExecutionState(turn),
      requiresAction: [
        buildInterruptedTurnAction({ sessionId: turn.sessionId, turnId: turn.turnId }),
      ],
    };
  });
}

/** 最后一轮若呈现为中断，返回它的派生视图；否则 undefined。 */
export function lastInterruptedTurnView(
  session: AgentSession,
  live: boolean,
): AgentTurn | undefined {
  const last = session.turns[session.turns.length - 1];
  if (!last || live || !isInterruptedTurnView(last)) {
    return undefined;
  }
  return {
    ...last,
    status: "interrupted",
    executionState: interruptedTurnExecutionState(last),
    requiresAction: [
      buildInterruptedTurnAction({
        sessionId: last.sessionId,
        turnId: last.turnId,
        instruction: last.instruction,
        used: last.toolCallsExecuted,
        matterId: session.matterId,
      }),
    ],
  };
}

/**
 * 恢复入口：`pendingRequiresAction` 里没有该 id 时，回落到派生的中断卡片。
 * 返回 undefined 表示确实没有这个待办。
 */
export function resolveInterruptedActionForResume(
  session: AgentSession,
  live: boolean,
  actionId: string,
): LawMindRequiresAction | undefined {
  if (!isInterruptedActionId(actionId)) {
    return undefined;
  }
  const turnId = actionId.slice(INTERRUPTED_ACTION_PREFIX.length).trim();
  const turn = session.turns.find((t) => t.turnId === turnId);
  if (!turn || live || !isInterruptedTurnView(turn)) {
    return undefined;
  }
  return buildInterruptedTurnAction({
    sessionId: turn.sessionId,
    turnId: turn.turnId,
    instruction: turn.instruction,
    used: turn.toolCallsExecuted,
    matterId: session.matterId,
  });
}

/** 中断卡片对应的轮次（用于恢复时带出原指令）。 */
export function interruptedTurnForAction(
  session: AgentSession,
  actionId: string,
): AgentTurn | undefined {
  if (!isInterruptedActionId(actionId)) {
    return undefined;
  }
  const turnId = actionId.slice(INTERRUPTED_ACTION_PREFIX.length).trim();
  return session.turns.find((t) => t.turnId === turnId);
}

/**
 * 读路径挂钩：把派生的中断卡片放到 `session.pendingRequiresAction`，
 * 这样既有的会话气泡 / 待我拍板 / `/api/chat/resume` 都能找到它。
 * 只改内存对象；调用方决定是否落盘（`action-summary` 会落盘以便跨请求稳定）。
 */
export function applyDerivedInterruptedAction(
  session: AgentSession,
  live: boolean,
): ReturnType<typeof lastInterruptedTurnView> {
  const view = lastInterruptedTurnView(session, live);
  if (!view?.requiresAction?.length) {
    return undefined;
  }
  const existing = session.pendingRequiresAction ?? [];
  const already = existing.some((a) => isInterruptedTurnAction(a));
  session.pendingRequiresAction = already ? existing : [...existing, ...view.requiresAction];
  return view;
}
