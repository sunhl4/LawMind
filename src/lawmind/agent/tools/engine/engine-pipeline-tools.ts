import { linkDraftToDeliverable } from "../../../application/services/deliverable-service.js";
import { validateDraftAgainstSpec } from "../../../deliverables/index.js";
import { persistDraft, readDraft } from "../../../drafts/index.js";
import { readTaskRecord } from "../../../tasks/index.js";
import type { ArtifactSection } from "../../../types.js";
import type { AgentContext, AgentTool } from "../../types.js";
import { formatRenderToolError } from "../render-tool-messages.js";
import {
  asNonEmptyString,
  asOptionalString,
  blockHeavyPipelineIfClarificationPending,
  canDraftWithoutResearch,
  getEngine,
  MAX_AUDIENCE_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  MAX_TITLE_LENGTH,
  resolveDefaultRenderTaskId,
  resolveMatterId,
  resolveTemplateId,
} from "./engine-tool-shared.js";

// ─────────────────────────────────────────────
// plan_task — 解析指令生成任务意图
// ─────────────────────────────────────────────

export const planTask: AgentTool = {
  definition: {
    name: "plan_task",
    description:
      "解析一条法律工作指令，生成结构化的任务意图（TaskIntent）。包含任务类型、风险等级、输出格式、是否需要确认等。这是启动任何法律工作的第一步。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "律师的工作指令", required: true },
      audience: { type: "string", description: "目标受众（内部/客户/对方/法院）" },
      matter_id: { type: "string", description: "关联案件 ID" },
    },
  },
  async execute(params, ctx) {
    try {
      const engine = getEngine(ctx);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          kind: intent.kind,
          deliverableType: intent.deliverableType,
          summary: intent.summary,
          riskLevel: intent.riskLevel,
          output: intent.output,
          requiresConfirmation: intent.requiresConfirmation,
          models: intent.models,
          matterId: intent.matterId,
          templateId: intent.templateId,
          acceptanceCriteria: intent.acceptanceCriteria,
          clarificationQuestions: intent.clarificationQuestions,
        },
      };
    } catch (err) {
      return { ok: false, error: `计划失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// research_task — 执行检索
// ─────────────────────────────────────────────

export const researchTask: AgentTool = {
  definition: {
    name: "research_task",
    description:
      "对已计划的任务执行法律检索。会调用配置的模型（通用+法律专用）进行检索和分析，返回来源、结论、风险标记等。高风险任务需要先确认才能检索。",
    category: "analyze",
    parameters: {
      task_id: { type: "string", description: "任务 ID（由 plan_task 返回）", required: true },
      instruction: { type: "string", description: "原始指令（用于重建 intent）", required: true },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const taskId = asNonEmptyString(params.task_id, "task_id", 128);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });
      // Override taskId if provided (to reuse existing task)
      (intent as { taskId: string }).taskId = taskId;

      // Auto-confirm if needed
      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, {
          actorId: ctx.actorId,
          note: "Agent 自动确认（高风险任务将在交付前再次请求律师审批）",
        });
      }

      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          return {
            ok: true,
            data: {
              taskId: intent.taskId,
              sourcesCount: 0,
              claimsCount: 0,
              researchDegraded: true,
              riskFlags: bundle.riskFlags,
              missingItems: bundle.missingItems,
              hint: "检索为空，但可继续 execute_workflow 或 draft_document 生成待审核草稿（含占位符）。",
            },
          };
        }
        return {
          ok: false,
          error: "检索返回空结果（sources=0, claims=0）。请检查模型配置或补充案件资料后重试。",
        };
      }

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          sourcesCount: bundle.sources.length,
          claimsCount: bundle.claims.length,
          riskFlags: bundle.riskFlags,
          missingItems: bundle.missingItems,
          topClaims: bundle.claims.slice(0, 5).map((c) => ({
            text: c.text,
            model: c.model,
            confidence: Math.round(c.confidence * 100),
          })),
          topSources: bundle.sources.slice(0, 5).map((s) => ({
            title: s.title,
            kind: s.kind,
            citation: s.citation,
          })),
        },
      };
    } catch (err) {
      return { ok: false, error: `检索失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

function resolveDraftTaskIdForUpdate(params: Record<string, unknown>, ctx: AgentContext): string {
  const fromParam = typeof params.task_id === "string" ? params.task_id.trim() : "";
  if (fromParam) {
    return fromParam;
  }
  const linked = typeof ctx.linkedTaskId === "string" ? ctx.linkedTaskId.trim() : "";
  if (linked) {
    return linked;
  }
  throw new Error("task_id 必填；若从审核台修订进入，应已关联草稿 ID");
}

function parseDraftSectionsInput(value: unknown): ArtifactSection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("sections 必须是非空数组");
  }
  const sections: ArtifactSection[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new Error("sections 项格式无效");
    }
    const record = item as Record<string, unknown>;
    const heading = typeof record.heading === "string" ? record.heading.trim() : "";
    const body = typeof record.body === "string" ? record.body : "";
    if (!heading) {
      throw new Error("sections 每项须含非空 heading");
    }
    const citations = Array.isArray(record.citations)
      ? record.citations.filter(
          (cite): cite is string => typeof cite === "string" && cite.trim().length > 0,
        )
      : undefined;
    sections.push({
      heading,
      body,
      ...(citations?.length ? { citations } : {}),
    });
  }
  return sections;
}

// ─────────────────────────────────────────────
// update_draft — 更新已有草稿正文（审核修订）
// ─────────────────────────────────────────────

export const updateDraft: AgentTool = {
  definition: {
    name: "update_draft",
    description:
      "更新工作区已有草稿的正文（title / summary / sections）。用于审核台「需修改」后的改稿：只更新同一条 drafts/<taskId>.json，不会新建 taskId。task_id 可省略（使用当前关联草稿）。",
    category: "draft",
    parameters: {
      task_id: {
        type: "string",
        description: "草稿 taskId（与 drafts/<taskId>.json 一致）；省略时使用会话关联草稿",
      },
      title: { type: "string", description: "文书标题" },
      summary: { type: "string", description: "执行摘要" },
      sections: {
        type: "array",
        description: "正文章节数组；每项为 { heading: string, body: string, citations?: string[] }",
      },
    },
    // Draft revision during chat should not interrupt the lawyer; final delivery stays on 文书台.
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    try {
      const taskId = resolveDraftTaskIdForUpdate(params, ctx);
      const draft = readDraft(ctx.workspaceDir, taskId);
      if (!draft) {
        return { ok: false, error: `找不到草稿 ${taskId}（drafts/${taskId}.json）` };
      }
      const reviewStatus = draft.reviewStatus ?? "pending";
      if (reviewStatus !== "pending" && reviewStatus !== "modified") {
        return {
          ok: false,
          error: `草稿状态为「${reviewStatus}」，无法直接更新正文。请先恢复待审核。`,
        };
      }
      const title = asOptionalString(params.title, "title", MAX_TITLE_LENGTH);
      const summary =
        params.summary !== undefined
          ? asNonEmptyString(params.summary, "summary", 48_000)
          : undefined;
      const sections =
        params.sections !== undefined ? parseDraftSectionsInput(params.sections) : undefined;
      if (title === undefined && summary === undefined && sections === undefined) {
        return { ok: false, error: "至少提供 title、summary 或 sections 之一" };
      }
      const next = {
        ...draft,
        ...(title !== undefined ? { title } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(sections !== undefined ? { sections } : {}),
      };
      if (next.taskId !== taskId) {
        return { ok: false, error: "taskId 不可变更" };
      }
      persistDraft(ctx.workspaceDir, next);
      if (next.matterId) {
        try {
          const tr = readTaskRecord(ctx.workspaceDir, taskId);
          linkDraftToDeliverable(ctx.workspaceDir, next, tr ?? undefined);
        } catch {
          // 写侧失败不阻断正文保存
        }
      }
      const acceptance = validateDraftAgainstSpec(next);
      return {
        ok: true,
        data: {
          taskId: next.taskId,
          title: next.title,
          sectionsCount: next.sections.length,
          reviewStatus: next.reviewStatus,
          acceptanceReady: acceptance.ready,
          draftPath: `drafts/${taskId}.json`,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `更新草稿失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

// ─────────────────────────────────────────────
// draft_document — 生成文书草稿
// ─────────────────────────────────────────────

export const draftDocument: AgentTool = {
  definition: {
    name: "draft_document",
    description:
      "基于检索结果生成文书草稿。会产出结构化的文书（包含标题、章节、引用等），并自动持久化到工作区。返回 data.citationIntegrity：将草稿章节 citations 与检索 bundle 来源 ID 对照（ok / missingSourceIds / sectionsWithIssues）。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "原始工作指令", required: true },
      title: { type: "string", description: "文书标题（可选，自动推断）" },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
      template_id: {
        type: "string",
        description:
          "模板 ID（如 word/legal-memo-default、ppt/client-brief-default、upload/firm-brief）",
      },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const instruction = asNonEmptyString(
        params.instruction,
        "instruction",
        MAX_INSTRUCTION_LENGTH,
      );
      const title = asOptionalString(params.title, "title", MAX_TITLE_LENGTH);
      const audience = asOptionalString(params.audience, "audience", MAX_AUDIENCE_LENGTH);
      const matterId = resolveMatterId(params.matter_id, ctx.matterId);
      const templateId = resolveTemplateId(params.template_id);
      const intent = await engine.planAsync(instruction, {
        audience,
        matterId,
      });

      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, { actorId: ctx.actorId });
      }

      const bundle = await engine.research(intent);
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          // Deliverable-first drafting can still produce a full editable draft with placeholders.
        } else {
          return {
            ok: false,
            error: "检索返回空结果，无法生成可靠草稿。请补充信息后重试。",
          };
        }
      }
      const draft = await engine.draftAsync(intent, bundle, {
        title,
        templateId,
      });

      return {
        ok: true,
        data: {
          taskId: draft.taskId,
          title: draft.title,
          output: draft.output,
          templateId: draft.templateId,
          deliverableType: draft.deliverableType,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => ({
            heading: s.heading,
            bodyPreview: s.body.slice(0, 100),
            citationsCount: s.citations?.length ?? 0,
          })),
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
          acceptanceCriteria: draft.acceptanceCriteria,
          clarificationQuestions: draft.clarificationQuestions,
          deliveryReadiness:
            draft.clarificationQuestions && draft.clarificationQuestions.length > 0
              ? "draft_with_placeholders"
              : "draft_ready",
        },
      };
    } catch (err) {
      return { ok: false, error: `起草失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────
// render_document — 渲染最终交付物
// ─────────────────────────────────────────────

export const renderDocument: AgentTool = {
  definition: {
    name: "render_document",
    description:
      "将草稿渲染为最终交付物（Word 文档等）。可指定 task_id；若省略，则优先使用律师在桌面工作台为当前会话关联的草稿（linkedTaskId），否则回退到最近一份草稿。若律师已在当前对话中明确同意导出，可传 approve=true 先批准再渲染。",
    category: "draft",
    parameters: {
      task_id: {
        type: "string",
        description: "任务 ID；不传时优先工作台关联草稿，否则为最近一份草稿",
      },
      approve: { type: "boolean", description: "律师已明确同意导出时设为 true，先批准草稿再渲染" },
      approval_note: { type: "string", description: "审批备注（可选）" },
      bypass_acceptance_gate: {
        type: "boolean",
        description:
          "默认 false：草稿未通过 Deliverable-First 验收门禁时拒绝渲染。仅在律师已确认草稿完整、知道接受占位符的前提下设为 true。",
      },
    },
    requiresApproval: true,
    riskLevel: "high",
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const engine = getEngine(ctx);
      const taskId =
        params.task_id === undefined
          ? resolveDefaultRenderTaskId(ctx, ctx.workspaceDir)
          : asNonEmptyString(params.task_id, "task_id", 128);
      const approvalNote = asOptionalString(params.approval_note, "approval_note", 500);
      const shouldApprove = params.approve === true;
      // 律师在对话中明确同意导出时，视为可跳过验收门禁（仍须过审核状态或 approve 批准）。
      const bypassGate = params.bypass_acceptance_gate === true || shouldApprove;
      if (!taskId) {
        return {
          ok: false,
          error: "当前没有可渲染的草稿。请先使用 draft_document 或 execute_workflow 生成草稿。",
        };
      }
      const draft = engine.getDraft(taskId);

      if (!draft) {
        return {
          ok: false,
          error: `找不到任务 ${taskId} 的草稿。请先使用 draft_document 或 execute_workflow 生成草稿。`,
        };
      }

      let approvedDraft = draft;
      if (approvedDraft.reviewStatus !== "approved" && shouldApprove) {
        approvedDraft = await engine.review(approvedDraft, {
          actorId: ctx.actorId,
          status: "approved",
          note: approvalNote ?? "律师在当前对话中明确同意导出最终文书。",
        });
      }

      if (approvedDraft.reviewStatus !== "approved") {
        const approvalErr = `草稿尚未通过审核（当前状态：${approvedDraft.reviewStatus}）。渲染 Word 前需要律师审批；若律师已明确同意导出，请使用 approve=true 重新调用。`;
        return {
          ok: false,
          error: formatRenderToolError(approvalErr),
          pendingApproval: true,
          data: {
            renderFailureCategory: "approval_required",
            gateDecision: {
              gate: "approval_gate",
              decision: "awaiting_confirmation",
              reason: `draft status=${approvedDraft.reviewStatus}`,
            },
          },
        };
      }

      // Acceptance Gate (Deliverable-First Architecture):
      // 在调用渲染管线前先跑验收；未通过时默认拒绝渲染，把 report 挂到 detail 让 agent 把清单原文展示给律师。
      // 当律师明确知情接受占位符时可传 bypass_acceptance_gate=true 走旁路。
      const acceptance = validateDraftAgainstSpec(approvedDraft);
      if (!acceptance.ready && !bypassGate) {
        const gateErr = `草稿未通过验收门禁（blockers=${acceptance.blockerCount}, placeholders=${acceptance.placeholderCount}）。请先补齐缺失内容再渲染；若律师已确认接受占位符，可使用 bypass_acceptance_gate=true 或 approve=true 重新调用。`;
        return {
          ok: false,
          error: formatRenderToolError(gateErr),
          pendingApproval: true,
          data: {
            taskId: approvedDraft.taskId,
            title: approvedDraft.title,
            acceptance,
            renderFailureCategory: "acceptance_gate",
            gateDecision: {
              gate: "acceptance_gate",
              decision: "block",
              reason: "acceptance not ready",
            },
          },
        };
      }

      const result = await engine.render(approvedDraft);
      if (result.ok) {
        return {
          ok: true,
          data: {
            taskId: approvedDraft.taskId,
            title: approvedDraft.title,
            outputPath: result.outputPath,
            acceptance,
            message: `文书已渲染完成（本地 Word 引擎）：${result.outputPath}`,
          },
        };
      }
      return {
        ok: false,
        error: formatRenderToolError(result.error ?? "渲染失败"),
        data: { renderFailureCategory: "render_engine" },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: formatRenderToolError(`渲染失败: ${msg}`) };
    }
  },
};
