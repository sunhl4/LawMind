/**
 * Agent tool: execute deep-research plan → ResearchBundle + evidence-backed outline.
 */

import { persistResearchSnapshot } from "../../drafts/research-snapshot.js";
import { loadMemoryContext } from "../../memory/index.js";
import { readWorkspacePolicyFile } from "../../policy/workspace-policy.js";
import { formatDeepResearchPlanMarkdown } from "../../research/deep-research-plan.js";
import { executeDeepResearchPlan } from "../../research/execute-deep-research.js";
import { persistResearchOutline } from "../../research/outline-store.js";
import { evaluateResearchEvidenceGate } from "../../research/research-evidence-gate.js";
import { formatOutlineMarkdown } from "../../research/research-outline.js";
import { route } from "../../router/keyword-route.js";
import { ensureTaskRecord, updateTaskRecord } from "../../tasks/index.js";
import { friendlyModelErrorMessage } from "../model-error-message.js";
import type { AgentTool } from "../types.js";
import { buildAdaptersFromEnv } from "./engine/engine-tool-shared.js";

export const lawMindDeepResearchTool: AgentTool = {
  definition: {
    name: "deep_research",
    description:
      "执行深度研究计划：多视角问题树 → 检索/URL 卷宗 → 证据驱动大纲，并写入 ResearchBundle 与 outline 快照。合规卷宗/调研简报/培训课件在确认大纲前不会扩写正文。",
    category: "search",
    parameters: {
      instruction: {
        type: "string",
        description: "研究主题或完整指令",
        required: true,
      },
      matter_id: { type: "string", description: "可选案件 ID" },
      breadth: { type: "number", description: "研究广度 2-6，默认 4" },
      depth: { type: "number", description: "研究深度 1-3，默认 2" },
    },
  },
  async execute(params, ctx) {
    const instruction = typeof params.instruction === "string" ? params.instruction.trim() : "";
    if (!instruction) {
      return { ok: false, error: "instruction 不能为空" };
    }
    try {
      const matterId =
        typeof params.matter_id === "string" && params.matter_id.trim()
          ? params.matter_id.trim()
          : ctx.matterId;
      const intent = route({ instruction, matterId });
      ensureTaskRecord(ctx.workspaceDir, intent, { assistantId: ctx.assistantId });
      updateTaskRecord(ctx.workspaceDir, intent.taskId, { status: "researching" });
      const memory = await loadMemoryContext(ctx.workspaceDir, { matterId });
      const adapters = buildAdaptersFromEnv(ctx.workspaceDir, {
        allowWebSearch: ctx.allowWebSearch === true,
      });
      const breadth =
        typeof params.breadth === "number" && Number.isFinite(params.breadth)
          ? Math.floor(params.breadth)
          : undefined;
      const depth =
        typeof params.depth === "number" && Number.isFinite(params.depth)
          ? Math.floor(params.depth)
          : undefined;
      const result = await executeDeepResearchPlan({
        intent,
        memory,
        adapters,
        workspacePolicy: readWorkspacePolicyFile(ctx.workspaceDir),
        allowWebSearch: ctx.allowWebSearch === true,
        signal: ctx.abortSignal,
        breadth,
        depth,
      });
      persistResearchSnapshot(ctx.workspaceDir, result.bundle);
      persistResearchOutline(ctx.workspaceDir, intent.taskId, result.outline);
      updateTaskRecord(ctx.workspaceDir, intent.taskId, { status: "researched" });
      const evidenceGate = evaluateResearchEvidenceGate({
        deliverableType: intent.deliverableType,
        bundle: result.bundle,
        allowWebSearch: ctx.allowWebSearch === true,
      });
      const outlinePending = result.outline.status === "pending";
      let nextStep: string;
      if (evidenceGate.block) {
        nextStep = evidenceGate.nextStep;
      } else if (outlinePending) {
        nextStep =
          "请律师在澄清卡片确认大纲后，再调用 draft_document（task_id 使用本返回的 taskId）。勿用 write_document 旁路。";
      } else {
        nextStep = "大纲已确认，可 draft_document（传入本 taskId）。";
      }
      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          linkedTaskId: intent.taskId,
          deliverableType: intent.deliverableType,
          planMarkdown: formatDeepResearchPlanMarkdown(result.plan),
          outlineMarkdown: formatOutlineMarkdown(result.outline),
          outlineStatus: result.outline.status,
          sourcesCount: result.bundle.sources.length,
          claimsCount: result.bundle.claims.length,
          riskFlags: result.bundle.riskFlags.slice(0, 8),
          evidenceReady: !evidenceGate.block,
          ...(evidenceGate.block
            ? {
                gateDecision: evidenceGate.gateDecision,
                nextActions: evidenceGate.nextActions,
              }
            : {}),
          nextStep,
        },
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return { ok: false, error: friendlyModelErrorMessage(`深度研究失败: ${raw}`) };
    }
  },
};
