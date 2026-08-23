/**
 * Turn orchestrator events and reply helpers.
 */
import type { ClarificationQuestion } from "../types.js";
import type { AgentSession, AgentTurn } from "./types.js";

export function extractClarificationQuestions(result: {
  ok: boolean;
  data?: unknown;
}): ClarificationQuestion[] {
  if (!result.ok || !result.data || typeof result.data !== "object") {
    return [];
  }
  const data = result.data as {
    clarificationQuestions?: unknown;
    deliveryReadiness?: unknown;
  };
  if (data.deliveryReadiness !== "draft_with_placeholders") {
    return [];
  }
  if (!Array.isArray(data.clarificationQuestions)) {
    return [];
  }
  return data.clarificationQuestions.filter(
    (item): item is ClarificationQuestion =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { key?: unknown }).key === "string" &&
      typeof (item as { question?: unknown }).question === "string",
  );
}

export function extractToolErrorMessage(result: { ok: boolean; error?: string }): string {
  if (typeof result.error === "string" && result.error.length > 0) {
    return result.error;
  }
  return "tool_failed";
}

export function buildClarificationReply(
  assistantReply: string,
  questions: ClarificationQuestion[],
  intro = "已生成可继续编辑的正式草稿，但要完成最终交付，还需要你补充以下关键信息：",
): string {
  const body = questions.map((item, index) => `${index + 1}. ${item.question}`).join("\n");
  const prefix = assistantReply.trim();
  return prefix ? `${prefix}\n\n${intro}\n${body}` : `${intro}\n${body}`;
}

/** When the model ends with tool-only hops and no final prose, synthesize a lawyer-facing summary. */
export function buildTurnReplyFallback(turn: AgentTurn): string {
  const lines: string[] = [];
  for (const msg of turn.messages) {
    if (msg.role !== "tool" || !msg.toolCallResponses?.length) {
      continue;
    }
    for (const tr of msg.toolCallResponses) {
      const name = tr.name;
      if (tr.result.ok) {
        const data = tr.result.data;
        if (data && typeof data === "object" && data !== null) {
          const rec = data as Record<string, unknown>;
          if (typeof rec.outputPath === "string" && rec.outputPath.trim()) {
            lines.push(`已生成交付文件：${rec.outputPath.trim()}`);
            continue;
          }
          if (typeof rec.message === "string" && rec.message.trim()) {
            lines.push(rec.message.trim());
            continue;
          }
          if (typeof rec.taskId === "string" && rec.taskId.trim()) {
            lines.push(`草稿任务 ID：${rec.taskId.trim()}（可在文书台打开）`);
            continue;
          }
        }
        lines.push(`工具「${name}」已执行完成。`);
      } else {
        const err = extractToolErrorMessage(tr.result).slice(0, 400);
        lines.push(`工具「${name}」未完成：${err}`);
      }
    }
  }
  if (lines.length > 0) {
    return [
      "本轮模型未返回附加说明，以下为工具执行结果摘要：",
      ...lines.slice(-8),
      turn.status === "awaiting_approval"
        ? "\n有步骤等待您确认；请打开待我拍板或通过对话继续。"
        : "\n如需 Word，请在文书台对已通过草稿点击「渲染交付物」或「仍要导出 Word」。",
    ].join("\n");
  }
  if (turn.status === "awaiting_approval") {
    return "有操作等待您的确认。请查看工具结果，或在文书台继续签批与导出。";
  }
  return "本轮未生成文字说明。若您要求完善并导出 Word，请到文书台打开对应草稿：已通过签批的可点「仍要导出 Word」；或在对话中说明 task_id 让我调用 render_document。";
}

export type RunTurnEvent =
  | { type: "round_start"; roundIndex: number }
  | {
      type: "tool_call_start";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_call_end";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      ok: boolean;
      error?: string;
      resultPreview?: string;
      /** Statute/case search returned no authority — UI should show 缺源 banner. */
      authorityGap?: boolean;
      /** Open sample / demo CORPUS hits — UI should show 演示语料 watermark. */
      demoCorpus?: boolean;
    }
  | {
      type: "tool_progress";
      roundIndex: number;
      toolCallId: string;
      toolName: string;
      label: string;
    }
  | { type: "delta"; roundIndex: number; text: string }
  | {
      type: "clarification";
      questions: ClarificationQuestion[];
    }
  | {
      type: "final";
      status: AgentTurn["status"];
      reply: string;
    }
  | {
      type: "token_budget";
      used: number;
      effectiveLimit: number;
      level: "ok" | "warn" | "compact";
    }
  | {
      type: "tool_budget";
      used: number;
      maxToolCalls: number;
      level: "warn" | "hard";
    }
  | {
      type: "overflow_prune";
      prunedCount: number;
      charsRemoved: number;
    }
  | {
      type: "compact_boundary";
      sessionSummaryPath?: string;
      droppedMessageCount?: number;
    }
  | {
      type: "requires_action";
      payload: import("../platform/requires-action.js").LawMindRequiresAction;
    };

export function collectRecentToolNamesFromSession(session: AgentSession): string[] {
  const names = new Set<string>();
  for (let i = session.turns.length - 1; i >= 0 && names.size < 12; i--) {
    const turn = session.turns[i];
    if (!turn) {
      continue;
    }
    for (const msg of turn.messages) {
      for (const tc of msg.toolCalls ?? []) {
        names.add(tc.name);
      }
    }
  }
  return [...names];
}

export function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
