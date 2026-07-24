/**
 * Resume interrupted agent turns (tool approval, clarification).
 */

import { loadMemoryContext, type MemoryContext } from "../memory/index.js";
import { executionStateFromTurn } from "../platform/execution-state.js";
import {
  formatClarificationResumeMessage,
  toolDisplayNameZh,
  type ResumeRequiresActionInput,
} from "../platform/requires-action.js";
import { runTurn } from "./runtime.js";
import { loadSession, saveSession } from "./session.js";
import type { ToolRegistry } from "./tools/index.js";
import type { AgentConfig, AgentMessage, AgentTurn } from "./types.js";

export type ResumeTurnResult = {
  turn: AgentTurn;
  reply: string;
  sessionId: string;
  memoryContext: MemoryContext;
};

export type ResumeTurnOpts = {
  registry: ToolRegistry;
  matterId?: string;
  projectDir?: string;
  linkedTaskId?: string;
  onEvent?: Parameters<typeof runTurn>[0]["onEvent"];
  liveProgressSessionId?: string;
};

/** Resume after lawyer decision on a requires-action item. */
export async function resumeTurn(
  config: AgentConfig,
  registry: ToolRegistry,
  input: ResumeRequiresActionInput,
  opts: ResumeTurnOpts,
): Promise<ResumeTurnResult> {
  const session = loadSession(config.workspaceDir, input.sessionId);
  if (!session) {
    throw new Error("session_not_found");
  }

  const action = session.pendingRequiresAction?.find((a) => a.id === input.actionId);
  if (!action) {
    throw new Error("action_not_found");
  }

  if (action.kind === "clarification" && input.decision === "respond") {
    session.pendingRequiresAction = undefined;
    saveSession(config.workspaceDir, session);
    const qs = action.clarificationQuestions ?? [];
    const msg = formatClarificationResumeMessage(input.clarificationAnswers ?? {}, qs);
    return runTurn({
      config,
      registry,
      instruction: msg,
      sessionId: session.sessionId,
      matterId: session.matterId ?? opts.matterId,
      projectDir: opts.projectDir,
      linkedTaskId: opts.linkedTaskId,
      onEvent: opts.onEvent,
      liveProgressSessionId: opts.liveProgressSessionId,
    });
  }

  if (action.kind === "tool_approval") {
    if (input.decision === "reject") {
      session.pendingRequiresAction = undefined;
      const label = action.toolName ? toolDisplayNameZh(action.toolName) : "该操作";
      const reply = `已取消「${label}」，未执行相关步骤。`;
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
      const instruction = edited
        ? `【律师已修改参数并批准】请继续完成「${label}」。调用对应工具时请传 __approved: true，并使用律师确认后的参数。`
        : `【律师已批准】请继续完成「${label}」。调用对应工具时请传 __approved: true。`;
      return runTurn({
        config,
        registry,
        instruction,
        sessionId: session.sessionId,
        matterId: session.matterId ?? opts.matterId,
        projectDir: opts.projectDir,
        linkedTaskId: opts.linkedTaskId,
        preApproveToolName: action.toolName,
        preApproveToolArgs: edited ?? action.toolArgs,
        onEvent: opts.onEvent,
        liveProgressSessionId: opts.liveProgressSessionId,
      });
    }
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
  });
}
