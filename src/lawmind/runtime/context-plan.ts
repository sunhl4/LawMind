import { estimateTokenBudget, type TokenBudgetSnapshot } from "../agent/context-budget.js";
import type { AgentContext, AgentSession } from "../agent/types.js";
import type { LawMindWorkspacePolicy } from "../policy/workspace-policy.js";
import type { PinnedContextSummary } from "./pinned-context.js";

export type ContextPlanLayerId =
  | "matter_state"
  | "matter_strategy"
  | "pinned_context"
  | "recent_transcript"
  | "memory_recall"
  | "source_anchors"
  | "pending_actions"
  | "role_context";

export type ContextPlanLayer = {
  id: ContextPlanLayerId;
  label: string;
  reason: string;
  priority: number;
  included: boolean;
  evidence: string[];
};

export type ContextPlan = {
  sessionId: string;
  matterId?: string;
  assistantId?: string;
  tokenBudget: TokenBudgetSnapshot;
  compactRecommended: boolean;
  layers: ContextPlanLayer[];
};

function includedLayer(
  id: ContextPlanLayerId,
  label: string,
  priority: number,
  reason: string,
  included: boolean,
  evidence: string[],
): ContextPlanLayer {
  return { id, label, priority, reason, included, evidence };
}

export function buildContextPlan(params: {
  session: AgentSession;
  ctx: AgentContext;
  policy?: LawMindWorkspacePolicy | null;
  contextTokens?: number;
  pinnedContext?: PinnedContextSummary | null;
}): ContextPlan {
  const tokenBudget = estimateTokenBudget(params.session, params.policy, {
    contextTokens: params.contextTokens,
  });
  const matterId = params.ctx.matterId ?? params.session.matterId;
  const assistantId = params.ctx.assistantId ?? params.session.assistantId;
  const hasPendingActions =
    (params.session.pendingRequiresAction?.length ?? 0) > 0 ||
    params.session.pendingClarificationKeys?.length;
  const surfacedMemoryCount = params.session.alreadySurfacedMemoryPaths?.length ?? 0;
  const hasTranscript = params.session.conversationHistory.length > 0;
  const pinned = params.pinnedContext;
  const hasPinnedContext = Boolean(
    pinned?.included && (pinned.evidence.length > 0 || pinned.markdownBlock),
  );

  const layers: ContextPlanLayer[] = [
    includedLayer(
      "matter_state",
      "Matter state",
      100,
      "Matter facts, deliverables, queue, approvals, and deadlines are the legal work truth source.",
      Boolean(matterId),
      matterId ? [`matterId:${matterId}`] : [],
    ),
    includedLayer(
      "matter_strategy",
      "Matter strategy",
      90,
      "Strategy is loaded separately from chat so the model follows the current legal theory.",
      Boolean(matterId),
      matterId ? [`cases/${matterId}/MATTER_STRATEGY.md`] : [],
    ),
    includedLayer(
      "pinned_context",
      "Pinned truth sources",
      88,
      "Lawyer @-pinned files, evidence, clause playbook, fleet playbook, or matter theory for this turn.",
      hasPinnedContext,
      pinned?.evidence ?? [],
    ),
    includedLayer(
      "pending_actions",
      "Pending lawyer actions",
      85,
      "Open clarifications and approvals should be surfaced before starting more heavy work.",
      Boolean(hasPendingActions),
      [
        ...(params.session.pendingClarificationKeys ?? []).map((key) => `clarification:${key}`),
        ...(params.session.pendingRequiresAction ?? []).map((action) => `action:${action.kind}`),
      ],
    ),
    includedLayer(
      "recent_transcript",
      "Recent transcript",
      70,
      "Recent conversation remains useful runtime state but should not replace matter state.",
      hasTranscript,
      hasTranscript ? [`messages:${params.session.conversationHistory.length}`] : [],
    ),
    includedLayer(
      "memory_recall",
      "Memory recall",
      60,
      "Previously surfaced memory is tracked to avoid repeatedly injecting the same files.",
      surfacedMemoryCount > 0,
      params.session.alreadySurfacedMemoryPaths ?? [],
    ),
    includedLayer(
      "source_anchors",
      "Source anchors",
      55,
      "Draft and review work should prefer anchored source snippets over ungrounded summaries.",
      Boolean(params.ctx.linkedTaskId),
      params.ctx.linkedTaskId ? [`taskId:${params.ctx.linkedTaskId}`] : [],
    ),
    includedLayer(
      "role_context",
      "Role context",
      50,
      "Assistant role controls tool allowlists, risk ceilings, and handoff responsibility.",
      Boolean(assistantId),
      assistantId ? [`assistantId:${assistantId}`] : [],
    ),
  ];

  return {
    sessionId: params.session.sessionId,
    matterId,
    assistantId,
    tokenBudget,
    compactRecommended: tokenBudget.level === "compact",
    layers,
  };
}

export function buildContextPlanMarkdown(plan: ContextPlan): string {
  const lines: string[] = [
    "# LawMind Context Plan",
    "",
    `Session: ${plan.sessionId}`,
    plan.matterId ? `Matter: ${plan.matterId}` : "Matter: not selected",
    plan.assistantId ? `Assistant: ${plan.assistantId}` : "Assistant: default",
    `Token budget: ${plan.tokenBudget.used}/${plan.tokenBudget.effectiveLimit} (${plan.tokenBudget.level})`,
    "",
    "| Layer | Included | Reason | Evidence |",
    "|-------|----------|--------|----------|",
  ];
  for (const layer of plan.layers.toSorted((a, b) => b.priority - a.priority)) {
    lines.push(
      `| ${layer.label} | ${layer.included ? "yes" : "no"} | ${layer.reason} | ${layer.evidence.join(", ") || "-"} |`,
    );
  }
  return lines.join("\n");
}
