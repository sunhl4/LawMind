import {
  clearSessionPlanHandoff,
  loadSession,
  saveSession,
  sessionHistoryToSimpleMessages,
  setSessionPlanHandoff,
} from "../../../src/lawmind/agent/session.js";
import {
  autoCompactSessionHistory,
  writeCompactDigestFile,
} from "../../../src/lawmind/agent/compact.js";
import { distillCompactIntoMemorySuggestions } from "../../../src/lawmind/agent/compact-distill.js";
import {
  enhanceCompactDigestWithLlm,
  isCompactLlmDigestEnabled,
  replaceDroppedDigestInMessages,
} from "../../../src/lawmind/agent/compact-llm-digest.js";
import { estimateTokenBudget } from "../../../src/lawmind/agent/context-budget.js";
import { getLiveTurnProgress } from "../../../src/lawmind/agent/live-turn-progress.js";
import {
  deleteSessionMessagePairAtUiIndex,
  truncateSessionFromUiIndex,
} from "../../../src/lawmind/agent/session-message-mutate.js";
import { requestTurnAbort } from "../../../src/lawmind/agent/turn-abort.js";
import type { AgentMessage } from "../../../src/lawmind/agent/types.js";
import { loadTranscriptForResume, repairTranscriptChain } from "../../../src/lawmind/adapters/session-transcript/index.js";
import { resolveCapabilityEnvelope } from "../../../src/lawmind/models/capability-envelope.js";
import { resolveAgentModelById } from "../../../src/lawmind/models/resolve.js";
import { resolveLawMindRoot } from "../../../src/lawmind/assistants/store.js";
import { readWorkspacePolicyFile } from "../../../src/lawmind/policy/workspace-policy.js";
import { listPendingToolApprovals } from "../../../src/lawmind/platform/pending-tool-approvals.js";
import { z } from "zod";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { readJsonBody, sendJson } from "./lawmind-server-helpers.js";

const compactBodySchema = z.object({
  distill: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  useLlmDigest: z.boolean().optional(),
});

function resolveSessionEnvelope(workspaceDir: string, envFile?: string) {
  const lawMindRoot = resolveLawMindRoot(workspaceDir, envFile);
  const resolved = resolveAgentModelById(lawMindRoot);
  return resolveCapabilityEnvelope({
    contextTokens: resolved.model?.contextTokens ?? undefined,
    timeoutMs: resolved.model?.timeoutMs,
  });
}

const messagesMutateSchema = z.object({
  uiIndex: z.number().int().min(0),
  mode: z.enum(["truncate", "delete_pair"]).default("truncate"),
});

const planHandoffPutSchema = z.object({
  planText: z.string().max(4000),
  updatedAt: z.string().trim().min(1).optional(),
});

function dialogueKey(msg: AgentMessage): string {
  return `${msg.role}\0${msg.timestamp}\0${(msg.content ?? "").slice(0, 240)}`;
}

/** User/assistant rows present before compact but absent after (dropped history). */
function dialogueDroppedByCompact(
  before: AgentMessage[],
  after: AgentMessage[],
): AgentMessage[] {
  const kept = new Set(
    after
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(dialogueKey),
  );
  return before.filter((m) => {
    if (m.role !== "user" && m.role !== "assistant") {
      return false;
    }
    return !kept.has(dialogueKey(m));
  });
}

export async function handleSessionExtendedRoutes({
  ctx,
  pathname,
  req,
  res,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  const budgetMatch = /^\/api\/sessions\/([^/]+)\/context-budget$/.exec(pathname);
  if (budgetMatch && req.method === "GET") {
    const sessionId = budgetMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const policy = readWorkspacePolicyFile(workspaceDir);
    const envelope = resolveSessionEnvelope(workspaceDir, ctx.envFile);
    const budget = estimateTokenBudget(session, policy, {
      contextTokens: envelope.contextTokens,
      charsPerToken: envelope.charsPerToken,
    });
    sendJson(
      res,
      200,
      {
        ok: true,
        ...budget,
        contextTokens: envelope.contextTokens,
        maxOutputTokens: envelope.maxOutputTokens,
      },
      c,
    );
    return true;
  }

  const abortMatch = /^\/api\/sessions\/([^/]+)\/abort$/.exec(pathname);
  if (abortMatch && req.method === "POST") {
    const sessionId = abortMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    requestTurnAbort(sessionId);
    sendJson(res, 200, { ok: true, aborted: true, sessionId }, c);
    return true;
  }

  const mutateMatch = /^\/api\/sessions\/([^/]+)\/messages\/mutate$/.exec(pathname);
  if (mutateMatch && req.method === "POST") {
    const sessionId = mutateMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    if (getLiveTurnProgress(sessionId)?.status === "running") {
      sendJson(
        res,
        409,
        {
          ok: false,
          error: "turn_in_progress",
          message: "当前回合仍在生成，请先停止后再修改或删除消息。",
        },
        c,
      );
      return true;
    }
    let body: z.infer<typeof messagesMutateSchema>;
    try {
      body = await parseJsonBodyZod(req, messagesMutateSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid_body", issues: err.issues }, c);
        return true;
      }
      throw err;
    }
    const result =
      body.mode === "delete_pair"
        ? deleteSessionMessagePairAtUiIndex(session, body.uiIndex)
        : truncateSessionFromUiIndex(session, body.uiIndex);
    if (!result.ok) {
      sendJson(res, 400, { ok: false, error: result.error }, c);
      return true;
    }
    saveSession(workspaceDir, session);
    sendJson(
      res,
      200,
      {
        ok: true,
        mode: body.mode,
        removedCount: result.removedCount,
        messages: sessionHistoryToSimpleMessages(session),
      },
      c,
    );
    return true;
  }

  const compactMatch = /^\/api\/sessions\/([^/]+)\/compact$/.exec(pathname);
  if (compactMatch && req.method === "POST") {
    const sessionId = compactMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    let distill = false;
    let dryRun = false;
    let useLlmDigest = true;
    try {
      const raw = await readJsonBody(req);
      const parsed = compactBodySchema.safeParse(raw ?? {});
      if (parsed.success) {
        distill = parsed.data.distill === true;
        dryRun = parsed.data.dryRun === true;
        if (parsed.data.useLlmDigest === false) {
          useLlmDigest = false;
        }
      } else if (raw && typeof raw === "object" && (raw as { distill?: unknown }).distill === true) {
        distill = true;
      }
    } catch {
      distill = false;
    }
    const policy = readWorkspacePolicyFile(workspaceDir);
    const envelope = resolveSessionEnvelope(workspaceDir, ctx.envFile);
    const lawMindRoot = resolveLawMindRoot(workspaceDir, ctx.envFile);
    const resolvedModel = resolveAgentModelById(lawMindRoot);
    const beforeMessages = [...session.conversationHistory];
    const previewSession = {
      ...session,
      conversationHistory: [...session.conversationHistory],
    };
    let result = autoCompactSessionHistory(previewSession, workspaceDir, {
      maxHistoryMessages: envelope.maxHistoryMessages,
      policy,
      contextTokens: envelope.contextTokens,
      writeDigestFile: !dryRun,
    });
    let usedLlmDigest = false;

    if (dryRun) {
      sendJson(
        res,
        200,
        {
          ok: true,
          dryRun: true,
          compacted: result.compacted,
          droppedMessageCount: result.droppedMessageCount ?? 0,
          estimatedDroppedTokens: result.estimatedDroppedTokens ?? 0,
          useLlmDigestAvailable: isCompactLlmDigestEnabled() && Boolean(resolvedModel.model),
          useLlmDigest: useLlmDigest && isCompactLlmDigestEnabled(),
          messages: sessionHistoryToSimpleMessages(session),
        },
        c,
      );
      return true;
    }

    if (
      useLlmDigest &&
      result.compacted &&
      result.droppedDigest &&
      result.droppedSpan?.length &&
      resolvedModel.model &&
      isCompactLlmDigestEnabled()
    ) {
      try {
        const enhanced = await enhanceCompactDigestWithLlm({
          model: resolvedModel.model,
          extractiveDigest: result.droppedDigest,
          dropped: result.droppedSpan,
          contextTokens: envelope.contextTokens,
        });
        if (enhanced.usedLlm) {
          usedLlmDigest = true;
          result = {
            ...result,
            messages: replaceDroppedDigestInMessages(result.messages, enhanced.digest),
            droppedDigest: enhanced.digest,
          };
          writeCompactDigestFile(workspaceDir, session.matterId, enhanced.digest);
        }
      } catch {
        /* keep extractive */
      }
    }

    session.conversationHistory = result.messages;
    saveSession(workspaceDir, session);

    let distillResult:
      | {
          suggestionIds: string[];
          sessionSummaryAppended: boolean;
          preferenceSnippetCount: number;
        }
      | undefined;
    if (distill) {
      try {
        // When compacted, distill only dropped dialogue to avoid re-suggesting kept prefs.
        // When compact is a no-op (「沉淀学习」), use the full current history.
        const sourceMessages: AgentMessage[] = result.compacted
          ? dialogueDroppedByCompact(beforeMessages, result.messages)
          : beforeMessages;
        distillResult = await distillCompactIntoMemorySuggestions({
          workspaceDir,
          auditDir: `${workspaceDir}/audit`,
          session,
          sourceMessages,
        });
      } catch {
        distillResult = undefined;
      }
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        compacted: result.compacted,
        sessionSummaryPath: result.sessionSummaryPath,
        droppedMessageCount: result.droppedMessageCount,
        estimatedDroppedTokens: result.estimatedDroppedTokens,
        usedLlmDigest,
        messages: sessionHistoryToSimpleMessages(session),
        distill: distillResult,
      },
      c,
    );
    return true;
  }

  const resumeMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(pathname);
  if (resumeMatch && req.method === "POST") {
    const sessionId = resumeMatch[1];
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    const transcript = loadTranscriptForResume(workspaceDir, sessionId);
    if (transcript.length > 0) {
      const system = session.conversationHistory.filter((m) => m.role === "system").slice(0, 1);
      session.conversationHistory = [...system, ...repairTranscriptChain(transcript)];
      saveSession(workspaceDir, session);
    }
    const pendingApprovals = listPendingToolApprovals(workspaceDir, {
      matterId: session.matterId,
    }).filter((p) => p.sessionId === sessionId);
    sendJson(
      res,
      200,
      {
        ok: true,
        sessionId,
        messages: sessionHistoryToSimpleMessages(session),
        pendingApprovals: pendingApprovals.length,
      },
      c,
    );
    return true;
  }

  const planHandoffMatch = /^\/api\/sessions\/([^/]+)\/plan-handoff$/.exec(pathname);
  if (planHandoffMatch) {
    const sessionId = planHandoffMatch[1] ?? "";
    const session = loadSession(workspaceDir, sessionId);
    if (!session) {
      sendJson(res, 404, { ok: false, code: "not_found", message: "session not found" }, c);
      return true;
    }
    if (req.method === "GET") {
      sendJson(
        res,
        200,
        {
          ok: true,
          sessionId,
          planHandoff: session.planHandoff ?? null,
        },
        c,
      );
      return true;
    }
    if (req.method === "PUT" || req.method === "POST") {
      let body: z.infer<typeof planHandoffPutSchema>;
      try {
        body = await parseJsonBodyZod(req, planHandoffPutSchema);
      } catch (err) {
        if (isInvalidRequestBodyError(err)) {
          sendJson(res, 400, { ok: false, error: "invalid_body", issues: err.issues }, c);
          return true;
        }
        throw err;
      }
      const updated = setSessionPlanHandoff(
        workspaceDir,
        sessionId,
        body.planText,
        body.updatedAt,
      );
      sendJson(
        res,
        200,
        { ok: true, sessionId, planHandoff: updated?.planHandoff ?? null },
        c,
      );
      return true;
    }
    if (req.method === "DELETE") {
      const updated = clearSessionPlanHandoff(workspaceDir, sessionId);
      sendJson(
        res,
        200,
        { ok: true, sessionId, planHandoff: updated?.planHandoff ?? null },
        c,
      );
      return true;
    }
  }

  return false;
}
