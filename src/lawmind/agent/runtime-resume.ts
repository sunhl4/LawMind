/**
 * Resume interrupted agent turns (tool approval, clarification).
 */

import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import { executionStateFromTurn } from "../platform/execution-state.js";
import {
  formatClarificationResumeMessage,
  toolDisplayNameZh,
  type LawMindRequiresAction,
  type ResumeRequiresActionInput,
} from "../platform/requires-action.js";
import { mergeConfirmedAnswers } from "./confirmed-answers.js";
import { runTurn } from "./runtime.js";
import { withSessionTurnGate } from "./session-turn-gate.js";
import { loadSession, saveSession, upsertSessionTurn } from "./session.js";
import { resolveToolCallBudgets } from "./tool-budget.js";
import type { ToolRegistry } from "./tools/index.js";
import {
  interruptedTurnForAction,
  isInterruptedTurnAction,
  isSessionTurnLive,
  resolveInterruptedActionForResume,
} from "./turn-interrupt.js";
import type { AgentConfig, AgentMessage, AgentSession, AgentTurn } from "./types.js";

export type ResumeTurnResult = {
  turn: AgentTurn;
  reply: string;
  sessionId: string;
  memoryContext: MemoryContext;
};

export type ResumeTurnOpts = {
  /** Unused; registry is the positional argument. Kept optional for older callers. */
  registry?: ToolRegistry;
  matterId?: string;
  projectDir?: string;
  linkedTaskId?: string;
  onEvent?: Parameters<typeof runTurn>[0]["onEvent"];
  liveProgressSessionId?: string;
};

/**
 * 续跑落在哪一案：**待办卡片自带的那一案**。
 *
 * 卡片是律师看过、据此点头的授权，作用域在开卡时就固定了（`buildToolApprovalAction`
 * 等把当时的案件写进 `action.matterId`）。而会话的当前案件是可变的——律师可以在等
 * 批准期间把对话切到别的案子（工作台「用于对话」）。若续跑改读会话，一张「收进本案」
 * 的旧卡就会在新案里执行：批的是甲案，材料落进乙案（真实事故同类）。
 *
 * 与主流产品同一口径：审批针对的是**那一次调用**，恢复执行必须回到调用成立时的作用域，
 * 不能被之后切换的上下文改写。卡片没带案件（历史卡片）才回落到会话，再回落到调用方。
 */
function resolveResumeMatterId(
  action: Pick<LawMindRequiresAction, "matterId">,
  session: Pick<AgentSession, "matterId">,
  opts: Pick<ResumeTurnOpts, "matterId">,
): string | undefined {
  return action.matterId?.trim() || session.matterId?.trim() || opts.matterId?.trim() || undefined;
}

/**
 * 中断恢复的指令：把原指令带回模型，否则「继续」会变成没有目标的空转。
 * 标记 `【从检查点继续】` 让清单/无任务判定都按续作处理（见 turn-plan-model）。
 */
export function formatInterruptedResumeInstruction(instruction: string | undefined): string {
  const original = instruction?.trim();
  return [
    "【从检查点继续】律师同意继续本件。",
    original ? `原指令：\n${original}` : "",
    "请在已有对话与工具结果上接着完成，不要重复已成功的步骤；仍缺的依据标【待补充】或写入缓办。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Resume after lawyer decision on a requires-action item. */
export async function resumeTurn(
  config: AgentConfig,
  registry: ToolRegistry,
  input: ResumeRequiresActionInput,
  opts: ResumeTurnOpts,
): Promise<ResumeTurnResult> {
  return withSessionTurnGate(config.workspaceDir, input.sessionId, () =>
    resumeTurnUngated(config, registry, input, opts),
  );
}

async function resumeTurnUngated(
  config: AgentConfig,
  registry: ToolRegistry,
  input: ResumeRequiresActionInput,
  opts: ResumeTurnOpts,
): Promise<ResumeTurnResult> {
  const session = loadSession(config.workspaceDir, input.sessionId);
  if (!session) {
    throw new Error("session_not_found");
  }

  const action =
    session.pendingRequiresAction?.find((a) => a.id === input.actionId) ??
    // 中断轮次没有收尾，也就没有落盘的待办：读时派生同一张卡片按 id 找回。
    resolveInterruptedActionForResume(
      session,
      isSessionTurnLive(config.workspaceDir, session.sessionId),
      input.actionId,
    );
  if (!action) {
    throw new Error("action_not_found");
  }

  if (action.kind === "clarification" && input.decision === "respond") {
    session.pendingRequiresAction = undefined;
    // 律师已通过结构化卡片逐条作答：清除跨轮澄清键，解除本轮重工具硬门禁。
    session.pendingClarificationKeys = undefined;
    const confirmedAnswers = mergeConfirmedAnswers(
      session.lastConfirmedAnswers,
      input.clarificationAnswers,
    );
    if (confirmedAnswers) {
      session.lastConfirmedAnswers = confirmedAnswers;
    }
    saveSession(config.workspaceDir, session);
    const qs = action.clarificationQuestions ?? [];
    const msg = formatClarificationResumeMessage(input.clarificationAnswers ?? {}, qs);
    return runTurn({
      config,
      registry,
      instruction: msg,
      sessionId: session.sessionId,
      matterId: resolveResumeMatterId(action, session, opts),
      projectDir: opts.projectDir,
      linkedTaskId: opts.linkedTaskId,
      onEvent: opts.onEvent,
      liveProgressSessionId: opts.liveProgressSessionId,
      skipSessionTurnGate: true,
      confirmedAnswers,
    });
  }

  if (action.kind === "tool_approval") {
    if (input.decision === "reject") {
      session.pendingRequiresAction = undefined;
      const label = action.toolName ? toolDisplayNameZh(action.toolName) : "该操作";
      const reply = `已取消「${label}」，未执行相关步骤。用户已拒绝，不要重试。`;
      const agentMsg: AgentMessage = {
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      };
      session.conversationHistory.push(agentMsg);
      const lastTurn = session.turns[session.turns.length - 1];
      if (lastTurn) {
        lastTurn.status = "completed";
        lastTurn.result = reply;
        lastTurn.requiresAction = undefined;
        lastTurn.pendingToolApproval = undefined;
        lastTurn.completedAt = new Date().toISOString();
        lastTurn.executionState = executionStateFromTurn(lastTurn);
      }
      saveSession(config.workspaceDir, session);
      const turn: AgentTurn = lastTurn ?? {
        turnId: action.taskId ?? "resume",
        sessionId: session.sessionId,
        instruction: "",
        messages: [agentMsg],
        toolCallsExecuted: 0,
        status: "completed",
        result: reply,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return {
        turn,
        reply,
        sessionId: session.sessionId,
        memoryContext: await loadMemoryContext(config.workspaceDir, {
          matterId: session.matterId,
        }),
      };
    }

    if ((input.decision === "approve" || input.decision === "edit") && action.toolName) {
      session.pendingRequiresAction = undefined;
      saveSession(config.workspaceDir, session);
      const label = toolDisplayNameZh(action.toolName);
      const edited =
        input.decision === "edit" && input.editedArgs && typeof input.editedArgs === "object"
          ? input.editedArgs
          : undefined;
      // 批准态由服务端经 preApproveToolName/preApproveToolArgs 注入，模型无需（也无法）自填审批旗标。
      const instruction = edited
        ? `【律师已修改参数并批准】请继续完成「${label}」，使用律师确认后的参数。`
        : `【律师已批准】请继续完成「${label}」。`;
      return runTurn({
        config,
        registry,
        instruction,
        sessionId: session.sessionId,
        matterId: resolveResumeMatterId(action, session, opts),
        projectDir: opts.projectDir,
        linkedTaskId: opts.linkedTaskId,
        preApproveToolName: action.toolName,
        preApproveToolArgs: edited ?? action.toolArgs,
        onEvent: opts.onEvent,
        liveProgressSessionId: opts.liveProgressSessionId,
        skipSessionTurnGate: true,
      });
    }
  }

  if (action.kind === "continue_tools") {
    const interrupted = isInterruptedTurnAction(action);
    if (input.decision === "reject") {
      session.pendingRequiresAction = undefined;
      const reply = interrupted
        ? "已按您的意思弃办本件，不再继续改稿或导出。需要重开时说一声即可。"
        : "已先停在这里。需要时再打开对话继续。";
      const agentMsg: AgentMessage = {
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      };
      session.conversationHistory.push(agentMsg);
      const lastTurn = interrupted
        ? interruptedTurnForAction(session, action.id)
        : session.turns[session.turns.length - 1];
      if (lastTurn) {
        // 中断轮次从「running 占位」收口为已弃办：不再派生中断卡片。
        lastTurn.status = "completed";
        lastTurn.result = reply;
        lastTurn.requiresAction = undefined;
        lastTurn.completedAt = lastTurn.completedAt ?? new Date().toISOString();
        lastTurn.executionState = executionStateFromTurn(lastTurn);
        upsertSessionTurn(session, lastTurn);
      }
      saveSession(config.workspaceDir, session);
      const turn: AgentTurn = lastTurn ?? {
        turnId: action.taskId ?? "resume",
        sessionId: session.sessionId,
        instruction: "",
        messages: [agentMsg],
        toolCallsExecuted: 0,
        status: "completed",
        result: reply,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return {
        turn,
        reply,
        sessionId: session.sessionId,
        memoryContext: await loadMemoryContext(config.workspaceDir, {
          matterId: session.matterId,
        }),
      };
    }

    if (input.decision === "approve") {
      session.pendingRequiresAction = undefined;
      const interruptedTurn = interrupted
        ? interruptedTurnForAction(session, action.id)
        : undefined;
      if (interruptedTurn) {
        // 律师选择继续：占位轮次交还给本轮收尾（新回合用同一份历史接着办）。
        interruptedTurn.status = "completed";
        interruptedTurn.result = "已按您的意思继续本件。";
        interruptedTurn.completedAt = interruptedTurn.completedAt ?? new Date().toISOString();
        interruptedTurn.executionState = executionStateFromTurn(interruptedTurn);
        upsertSessionTurn(session, interruptedTurn);
      }
      saveSession(config.workspaceDir, session);
      const lastTurn = interruptedTurn ?? session.turns[session.turns.length - 1];
      const priorUsed =
        typeof action.toolCallsExecuted === "number" && action.toolCallsExecuted > 0
          ? action.toolCallsExecuted
          : (lastTurn?.toolCallsExecuted ?? 0);
      const budgets = resolveToolCallBudgets(config.maxToolCalls);
      return runTurn({
        config: { ...config, maxToolCalls: budgets.soft },
        registry,
        instruction: interrupted
          ? formatInterruptedResumeInstruction(action.instruction ?? interruptedTurn?.instruction)
          : "【从检查点继续】律师同意继续本轮。请在已有对话与工具结果上接着完成，不要重复已成功的步骤。",
        sessionId: session.sessionId,
        matterId: resolveResumeMatterId(action, session, opts),
        projectDir: opts.projectDir,
        linkedTaskId: opts.linkedTaskId,
        onEvent: opts.onEvent,
        liveProgressSessionId: opts.liveProgressSessionId,
        skipSessionTurnGate: true,
        skipToolBudgetCheckpoint: true,
        initialToolCallsExecuted: priorUsed,
      });
    }
  }

  // 门禁停下的缺口卡片：只需律师确认「知道了」，不改稿也不再跑。
  if (action.kind === "workflow_blocked") {
    session.pendingRequiresAction = undefined;
    const reply =
      input.decision === "reject"
        ? "已记下，本件按现状封存，不再自动重试。"
        : "已记录缺口。需要继续改稿或另出意见书时，说一声即可。";
    const agentMsg: AgentMessage = {
      role: "assistant",
      content: reply,
      timestamp: new Date().toISOString(),
    };
    session.conversationHistory.push(agentMsg);
    const lastTurn = session.turns[session.turns.length - 1];
    if (lastTurn) {
      lastTurn.requiresAction = undefined;
      upsertSessionTurn(session, lastTurn);
    }
    saveSession(config.workspaceDir, session);
    const turn: AgentTurn = lastTurn ?? {
      turnId: action.taskId ?? "resume",
      sessionId: session.sessionId,
      instruction: "",
      messages: [agentMsg],
      toolCallsExecuted: 0,
      status: "completed",
      result: reply,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return {
      turn,
      reply,
      sessionId: session.sessionId,
      memoryContext: await loadMemoryContext(config.workspaceDir, {
        matterId: session.matterId,
      }),
    };
  }

  throw new Error("unsupported_resume");
}

/**
 * Resume after user Stop when the last turn was checkpointed as `paused`.
 */
export async function resumePausedTurn(
  config: AgentConfig,
  registry: ToolRegistry,
  sessionId: string,
  opts?: ResumeTurnOpts & { extraInstruction?: string },
): Promise<ResumeTurnResult> {
  return withSessionTurnGate(config.workspaceDir, sessionId, () =>
    resumePausedTurnUngated(config, registry, sessionId, opts),
  );
}

async function resumePausedTurnUngated(
  config: AgentConfig,
  registry: ToolRegistry,
  sessionId: string,
  opts?: ResumeTurnOpts & { extraInstruction?: string },
): Promise<ResumeTurnResult> {
  const session = loadSession(config.workspaceDir, sessionId);
  if (!session) {
    throw new Error("session_not_found");
  }
  const last = [...session.turns].toReversed().find((t) => t.status === "paused");
  if (!last) {
    throw new Error("no_paused_turn");
  }
  const toolNames = last.messages
    .flatMap((m) => (m.toolCalls ?? []).map((tc) => tc.name))
    .filter(Boolean)
    .slice(0, 12);
  const toolsLine = toolNames.length > 0 ? `已用工具：${[...new Set(toolNames)].join("、")}。` : "";
  const extra = opts?.extraInstruction?.trim();
  const instruction = [
    "【从检查点继续】",
    `上一轮在完成 ${last.toolCallsExecuted} 次工具调用后被暂停。`,
    toolsLine,
    `原指令：\n${last.instruction}`,
    "",
    "请在已有对话与工具结果基础上继续完成任务，不要重复已成功的步骤。",
    extra ? `\n律师补充：${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Keep paused turn as historical checkpoint; new turn continues the session.
  return runTurn({
    config,
    registry,
    instruction,
    sessionId: session.sessionId,
    matterId: session.matterId ?? opts?.matterId,
    projectDir: opts?.projectDir,
    linkedTaskId: opts?.linkedTaskId,
    onEvent: opts?.onEvent,
    liveProgressSessionId: opts?.liveProgressSessionId,
    skipSessionTurnGate: true,
    skipToolBudgetCheckpoint: true,
    initialToolCallsExecuted: last.toolCallsExecuted,
  });
}
