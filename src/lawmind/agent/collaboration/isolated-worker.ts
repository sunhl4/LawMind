/**
 * Collaboration worker: one isolated read-only loop.
 * Not runTurn — no compact, playbook, approval pipeline, or nested delegation.
 */

import { applyEnvelopeToAgentModelDefaults } from "../../models/capability-envelope.js";
import { runDraftWorkerReadOnlyLoop } from "../draft-worker-loop.js";
import type { AgentConfig, AgentContext } from "../types.js";

const WORKER_INSTRUCTIONS = [
  "你是隔离工人，不是主办律师。",
  "只根据任务书作答。可以用只读工具核对材料与法条。",
  "禁止改原件，禁止外发，禁止再派给其他助手，禁止声称审核清单已经覆盖。",
  "落稿、改 Word、发信由主办会话完成。你只交回复、出处和缺口。",
].join("");

const COLLAB_CLOSE_PROMPT =
  "只读轮次已用尽。请直接写出完整答复、出处和缺口。不要输出文书 JSON，不要声称已经改过文件或发出邮件。";

export async function runIsolatedCollaborationWorker(params: {
  baseConfig: AgentConfig;
  sessionId: string;
  instruction: string;
  matterId?: string;
  roleTitle?: string;
  roleDirective?: string;
  abortSignal?: AbortSignal;
}): Promise<{ reply: string }> {
  const model = params.baseConfig.model;
  const envelope = applyEnvelopeToAgentModelDefaults({
    contextTokens: model.contextTokens,
    temperature: model.temperature,
    taskKind: "chat",
  });
  const roleBits = [params.roleTitle?.trim(), params.roleDirective?.trim()].filter(Boolean);
  const system = roleBits.length
    ? `${WORKER_INSTRUCTIONS}\n岗位语气仅供组织答复，不是自检清单：\n${roleBits.join("\n")}`
    : WORKER_INSTRUCTIONS;
  const ctx: AgentContext = {
    workspaceDir: params.baseConfig.workspaceDir,
    sessionId: params.sessionId,
    actorId: params.baseConfig.actorId ?? "collaboration-worker",
    matterId: params.matterId,
    chatModel: model,
    abortSignal: params.abortSignal,
    permissionMode: "readonly",
    inReadonlyWorkerLoop: true,
  };
  const loop = await runDraftWorkerReadOnlyLoop({
    model,
    maxTokens: envelope.maxTokens,
    timeoutMs: envelope.timeoutMs,
    temperature: envelope.temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: params.instruction },
    ],
    ctx,
    abortSignal: params.abortSignal,
    roleLabel: "协作答复",
    closePrompt: COLLAB_CLOSE_PROMPT,
  });
  if (loop.aborted) {
    throw new Error("已停止");
  }
  const reply = loop.text.trim();
  if (!reply) {
    throw new Error(loop.error?.trim() || "这一步没有写出可用答复。请重试，或改在当前对话里办理。");
  }
  return { reply };
}
