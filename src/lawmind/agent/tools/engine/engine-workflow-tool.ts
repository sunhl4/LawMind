import {
  persistResearchSnapshot,
  validateDraftCitationsAgainstBundle,
} from "../../../drafts/index.js";
import { loadMemoryContext } from "../../../memory/index.js";
import { readWorkspacePolicyFile } from "../../../policy/workspace-policy.js";
import { isOutlineGatedDeliverable } from "../../../reasoning/research-draft-gates.js";
import { executeDeepResearchPlan } from "../../../research/execute-deep-research.js";
import { persistResearchOutline, readResearchOutline } from "../../../research/outline-store.js";
import {
  evaluateResearchEvidenceGate,
  RESEARCH_EVIDENCE_GATE_REFUSAL,
} from "../../../research/research-evidence-gate.js";
import { isDemoCorpusResult } from "../../../retrieval/authority-gap.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  taskIntentFromRecordOnly,
  updateTaskRecord,
} from "../../../tasks/index.js";
import type { ResearchBundle, TaskIntent } from "../../../types.js";
import type { AgentTool } from "../../types.js";
import { formatWorkflowRenderFailure } from "../render-tool-messages.js";
import {
  asNonEmptyString,
  asOptionalString,
  blockHeavyPipelineIfClarificationPending,
  buildAdaptersFromEnv,
  canDraftWithoutResearch,
  DEMO_CORPUS_DRAFT_REFUSAL,
  getEngine,
  MAX_AUDIENCE_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  MAX_TITLE_LENGTH,
  pushWorkflowProgress,
  resolveMatterId,
  resolveTemplateId,
  shouldRefuseDraftOnDemoCorpus,
} from "./engine-tool-shared.js";

// ─────────────────────────────────────────────
// execute_workflow — 一键完整流程
// ─────────────────────────────────────────────

/**
 * force_render 是 demo/测试旁路（跳过律师审批与双门禁）。
 * 默认关闭：必须显式设置 LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER=1 才允许使用，
 * 防止模型在生产环境凭一个参数绕过「中/高风险需律师拍板」的信任门。
 */
export function isForceRenderAllowed(): boolean {
  return process.env.LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER === "1";
}

const LOCKABLE_DELIVERABLE_TYPES = new Set([
  "report.compliance",
  "report.learning",
  "ppt.training",
  "report.esg",
  "report.general",
]);

function parseLockedDeliverableType(raw: unknown): TaskIntent["deliverableType"] | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw.trim().toLowerCase();
  return LOCKABLE_DELIVERABLE_TYPES.has(t) ? t : undefined;
}

export const executeWorkflow: AgentTool = {
  definition: {
    name: "execute_workflow",
    description:
      '自主执行完整的法律工作流程：解析指令 → 检索法规和案例 → 生成文书草稿 → 自动审核（低风险）或标记等待律师审批（高风险）。**在需求已对齐的前提下**，文书类任务应优先调用本工具而非只写摘要。若上次因检索为空等原因中断，可传 **existing_task_id** + **restart_from: "research"** 跳过重新规划、重试检索及后续步骤。注意：桌面「关联草稿」ID（linkedTaskId）**不会**自动替代 `existing_task_id`；若要续跑律师当前聚焦的那份任务，请把该任务的 **taskId 显式写入 existing_task_id**。单独渲染未传 `task_id` 时由 `render_document` 优先 linkedTaskId。返回 data.citationIntegrity；失败时 data 可能含 recoverable / existingTaskId。',
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "律师的工作指令", required: true },
      title: { type: "string", description: "文书标题（可选）" },
      audience: { type: "string", description: "目标受众（内部/客户/对方/法院）" },
      matter_id: { type: "string", description: "关联案件 ID" },
      template_id: {
        type: "string",
        description:
          "模板 ID（如 word/legal-memo-default、ppt/client-brief-default、upload/firm-brief）",
      },
      auto_approve: {
        type: "boolean",
        description: "低风险任务是否自动批准草稿（默认 true）。高风险任务始终需要律师审批。",
      },
      force_render: {
        type: "boolean",
        description:
          "仅 demo/测试：中/高风险也自动批准并渲染，输出 .docx 路径。仅在进程环境变量 LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER=1 时才生效，否则工具直接报错。",
      },
      existing_task_id: {
        type: "string",
        description:
          "续跑：已有引擎任务 ID（workspace/tasks/<id>.json）。与 restart_from 联用可跳过重新 plan，直接重试检索及后续步骤（如上次检索为空或失败）。若律师在桌面已打开某草稿且与系统提示中的「关联草稿 ID」一致，应将该 ID 填在此处；本工具不会从 linkedTaskId 隐式推断。",
      },
      restart_from: {
        type: "string",
        description: '续跑起点：传 "research" 时跳过 plan，沿用该任务已持久化的意图。',
        enum: ["research"],
      },
      deliverable_type: {
        type: "string",
        description:
          "锁定交付物类型（如 report.compliance / report.learning / ppt.training / report.esg）。传入后 plan 不再按关键词改写类型。",
      },
    },
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    const steps: string[] = [];
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
      const autoApprove = params.auto_approve !== false;
      const forceRender = params.force_render === true;
      if (forceRender && !isForceRenderAllowed()) {
        return {
          ok: false,
          error:
            "force_render 已被禁用：该参数会跳过律师审批与验收门禁，仅在设置 LAWMIND_WORKFLOW_ALLOW_FORCE_RENDER=1 的 demo/测试环境可用。请去掉 force_render，让中/高风险任务等待律师审批，或改用 render_document 走正常签批流程。",
          data: { stepsCompleted: steps, recoverable: false },
        };
      }
      const existingTaskIdRaw =
        typeof params.existing_task_id === "string" ? params.existing_task_id.trim() : "";
      const restartFrom =
        typeof params.restart_from === "string" ? params.restart_from.trim().toLowerCase() : "";
      const lockedDeliverableType = parseLockedDeliverableType(params.deliverable_type);

      let intent: TaskIntent;

      if (existingTaskIdRaw) {
        if (restartFrom !== "research") {
          return {
            ok: false,
            error:
              '续跑时必须同时传入 restart_from: "research"（当前仅支持从检索阶段重试后续管线）。',
            data: { stepsCompleted: steps, recoverable: false },
          };
        }
        const rec = readTaskRecord(ctx.workspaceDir, existingTaskIdRaw);
        if (!rec) {
          return {
            ok: false,
            error: `未找到任务 ${existingTaskIdRaw}。请确认 taskId，或去掉续跑参数重新规划。`,
            data: { stepsCompleted: steps, recoverable: false },
          };
        }
        intent = taskIntentFromRecordOnly(rec);
        const mid = resolveMatterId(params.matter_id, matterId ?? intent.matterId);
        if (mid) {
          intent = { ...intent, matterId: mid };
        }
        if (templateId) {
          intent = { ...intent, templateId };
        }
        if (audience) {
          intent = { ...intent, audience };
        }
        pushWorkflowProgress(
          ctx,
          steps,
          `续跑任务 ${existingTaskIdRaw}：已跳过重新规划，沿用已持久化意图（${intent.summary.slice(0, 80)}…）。`,
        );
      } else {
        // Step 1: Plan
        pushWorkflowProgress(ctx, steps, "正在解析指令...");
        intent = await engine.planAsync(instruction, {
          audience,
          matterId,
          ...(lockedDeliverableType ? { deliverableType: lockedDeliverableType } : {}),
        });
        pushWorkflowProgress(
          ctx,
          steps,
          `任务计划完成：${intent.summary}（风险：${intent.riskLevel}${
            intent.deliverableType ? `，类型：${intent.deliverableType}` : ""
          }）`,
        );
      }

      // Step 2: Confirm (if needed)
      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, {
          actorId: ctx.actorId,
          note: "Agent 工作流自动确认",
        });
        pushWorkflowProgress(ctx, steps, "高风险任务已确认，进入检索阶段");
      }

      // Step 3: Research (outline-gated deliverables use deep-research + persist outline)
      let bundle: ResearchBundle;
      let outlinePending = false;
      if (isOutlineGatedDeliverable(intent.deliverableType)) {
        pushWorkflowProgress(ctx, steps, "正在执行深度研究（多视角检索 + 证据大纲）...");
        ensureTaskRecord(ctx.workspaceDir, intent, { assistantId: ctx.assistantId });
        updateTaskRecord(ctx.workspaceDir, intent.taskId, { status: "researching" });
        const memory = await loadMemoryContext(ctx.workspaceDir, { matterId: intent.matterId });
        const existingOutline = readResearchOutline(ctx.workspaceDir, intent.taskId);
        const deep = await executeDeepResearchPlan({
          intent,
          memory,
          adapters: buildAdaptersFromEnv(ctx.workspaceDir, {
            allowWebSearch: ctx.allowWebSearch === true,
          }),
          workspacePolicy: readWorkspacePolicyFile(ctx.workspaceDir),
          allowWebSearch: ctx.allowWebSearch === true,
          signal: ctx.abortSignal,
        });
        bundle = {
          ...deep.bundle,
          taskId: intent.taskId,
          query: deep.bundle.query || intent.summary,
        };
        persistResearchSnapshot(ctx.workspaceDir, bundle);
        // Never clobber a lawyer-approved outline with a fresh pending plan.
        if (existingOutline?.status === "approved") {
          outlinePending = false;
          pushWorkflowProgress(
            ctx,
            steps,
            `深度研究完成：${bundle.sources.length} 条来源，${bundle.claims.length} 条结论；沿用已确认大纲`,
          );
        } else {
          persistResearchOutline(ctx.workspaceDir, intent.taskId, deep.outline);
          outlinePending = deep.outline.status !== "approved";
          pushWorkflowProgress(
            ctx,
            steps,
            `深度研究完成：${bundle.sources.length} 条来源，${bundle.claims.length} 条结论；大纲 ${deep.outline.status}`,
          );
        }
        updateTaskRecord(ctx.workspaceDir, intent.taskId, { status: "researched" });
      } else {
        pushWorkflowProgress(ctx, steps, "正在检索法规和案例...");
        bundle = await engine.research(intent, { signal: ctx.abortSignal });
        pushWorkflowProgress(
          ctx,
          steps,
          `检索完成：${bundle.sources.length} 条来源，${bundle.claims.length} 条结论，${bundle.riskFlags.length} 条风险标记`,
        );
      }
      let researchDegraded = false;
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          researchDegraded = true;
          pushWorkflowProgress(
            ctx,
            steps,
            "检索结果为空或检索适配器未返回来源，但该任务属于完整文书起草，继续生成带待补充项的正式草稿。",
          );
        } else {
          return {
            ok: false,
            error: "检索返回空结果，工作流停止。请检查模型配置或先补充案件资料。",
            data: {
              stepsCompleted: steps,
              recoverable: true,
              existingTaskId: intent.taskId,
              restartFrom: "research",
              hint: '修正后可再次调用本工具：existing_task_id 填上述 taskId，restart_from 填 "research"，instruction 可沿用原句。',
            },
          };
        }
      }

      // Allow outline-only drafts even on demo/empty evidence; block body expansion below.
      if (!outlinePending && shouldRefuseDraftOnDemoCorpus(intent) && isDemoCorpusResult(bundle)) {
        return {
          ok: false,
          error: DEMO_CORPUS_DRAFT_REFUSAL,
          data: {
            stepsCompleted: steps,
            demoCorpus: true,
            recoverable: true,
            existingTaskId: intent.taskId,
            restartFrom: "research",
            gateDecision: {
              gate: "demo_corpus_gate",
              decision: "block",
              reason: "high-risk workflow with demo-only authority hits",
            },
            nextActions: [
              "enable_web_search",
              "open_settings_models",
              "open_settings_doctor",
              "restart_research",
            ],
            hint: "配置正式权威库或非演示 CORPUS 后，可带 existing_task_id 从 research 续跑。",
          },
        };
      }

      // Body expansion (outline already approved) must not proceed on empty/demo/failed evidence.
      if (!outlinePending) {
        const evidenceGate = evaluateResearchEvidenceGate({
          deliverableType: intent.deliverableType,
          bundle,
          allowWebSearch: ctx.allowWebSearch === true,
        });
        if (evidenceGate.block) {
          return {
            ok: false,
            error: RESEARCH_EVIDENCE_GATE_REFUSAL,
            data: {
              stepsCompleted: steps,
              recoverable: true,
              existingTaskId: intent.taskId,
              restartFrom: "research",
              restart_from: "research",
              demoCorpus: isDemoCorpusResult(bundle),
              gateDecision: evidenceGate.gateDecision,
              nextActions: evidenceGate.nextActions,
              nextStep: evidenceGate.nextStep,
              hint: evidenceGate.nextStep,
            },
          };
        }
      }

      // Step 4: Draft
      pushWorkflowProgress(ctx, steps, "正在生成文书草稿...");
      let draft;
      try {
        draft = await engine.draftAsync(intent, bundle, {
          title,
          templateId,
        });
      } catch (draftErr) {
        const msg = draftErr instanceof Error ? draftErr.message : String(draftErr);
        const code =
          draftErr && typeof draftErr === "object" && "code" in draftErr
            ? String((draftErr as { code?: string }).code ?? "")
            : "";
        if (code === "training_desense_gate" || /脱敏/.test(msg)) {
          return {
            ok: false,
            error: msg,
            data: {
              stepsCompleted: steps,
              taskId: intent.taskId,
              gateDecision: {
                gate: "training_desense_gate",
                decision: "block",
                reason: msg,
              },
              recoverable: true,
              existingTaskId: intent.taskId,
              restartFrom: "research",
              hint: "请脱敏当事人/电话/未公开事实后重试，或改用非培训交付物。",
            },
          };
        }
        throw draftErr;
      }
      pushWorkflowProgress(
        ctx,
        steps,
        `草稿生成完成：《${draft.title}》，共 ${draft.sections.length} 个章节`,
      );
      const citationIntegrity = validateDraftCitationsAgainstBundle(draft, bundle);
      if (!citationIntegrity.ok) {
        pushWorkflowProgress(
          ctx,
          steps,
          `引用校验：有 ${citationIntegrity.missingSourceIds.length} 个来源 ID 不在本次检索结果中（${citationIntegrity.missingSourceIds.join(", ")}），请人工核对。`,
        );
      }

      // Halt only on real outline-pending drafts (not sticky clarification keys after approve).
      const awaitingOutline = outlinePending || /大纲待确认/.test(draft.title);
      if (awaitingOutline) {
        pushWorkflowProgress(
          ctx,
          steps,
          "大纲待律师确认：本轮仅输出大纲，确认后再撰写正文（勿自动渲染）。",
        );
        return {
          ok: true,
          data: {
            taskId: intent.taskId,
            title: draft.title,
            kind: intent.kind,
            deliverableType: intent.deliverableType,
            riskLevel: intent.riskLevel,
            output: draft.output,
            matterId: intent.matterId,
            status: "awaiting_outline_confirmation",
            sectionsCount: draft.sections.length,
            sections: draft.sections.map((s) => s.heading),
            riskFlags: bundle.riskFlags,
            missingItems: bundle.missingItems,
            claimsCount: bundle.claims.length,
            sourcesCount: bundle.sources.length,
            outputPath: undefined,
            steps,
            researchDegraded,
            citationIntegrity,
            acceptanceCriteria: draft.acceptanceCriteria,
            clarificationQuestions: draft.clarificationQuestions,
            deliveryReadiness: "outline_pending",
            outlinePending: true,
            hint: "请在澄清卡片确认大纲（「大纲已确认」或粘贴修订 ## 章节）后，再 draft_document / execute_workflow。",
          },
        };
      }

      // Step 5: Auto-review or mark for approval (or force_render for demo)
      let finalStatus = "awaiting_review";
      const shouldAutoRender = (intent.riskLevel === "low" && autoApprove) || forceRender;
      if (shouldAutoRender) {
        await engine.review(draft, {
          actorId: ctx.actorId,
          status: "approved",
          note: forceRender ? "Demo 模式：自动批准并渲染。" : "低风险任务，Agent 自动审核通过。",
        });
        pushWorkflowProgress(
          ctx,
          steps,
          forceRender ? "Demo：已自动批准并渲染。" : "低风险任务，已自动审核通过。",
        );

        // Step 6: Render
        pushWorkflowProgress(ctx, steps, "正在渲染最终文档...");
        // force_render / low-risk auto-approve is a demo/automation path: skip dual gates
        // so Word export matches tool-level approve/bypass semantics.
        const result = await engine.render(draft, { strictGates: false });
        if (result.ok) {
          finalStatus = "delivered";
          pushWorkflowProgress(ctx, steps, `交付完成（本地 Word）：${result.outputPath}`);
          draft.outputPath = result.outputPath;
        } else {
          finalStatus = "render_failed";
          const renderErr = result.error ?? "渲染失败";
          pushWorkflowProgress(ctx, steps, `Word 渲染失败：${renderErr}`);
          pushWorkflowProgress(
            ctx,
            steps,
            "提示：生成 .docx 不依赖模型 API。可调用 render_document（approve=true）重试，或在审核台批准后导出。",
          );
          return {
            ok: false,
            error: formatWorkflowRenderFailure(renderErr),
            data: {
              taskId: intent.taskId,
              title: draft.title,
              kind: intent.kind,
              deliverableType: intent.deliverableType,
              riskLevel: intent.riskLevel,
              matterId: intent.matterId,
              status: finalStatus,
              sectionsCount: draft.sections.length,
              outputPath: undefined,
              steps,
              renderFailureCategory: "render_engine",
              hint: "草稿已生成但 Word 未导出。请用 render_document 重试，勿向用户声称模型 API 故障。",
            },
          };
        }
      } else {
        finalStatus = "awaiting_lawyer_review";
        pushWorkflowProgress(
          ctx,
          steps,
          `⚠ ${intent.riskLevel === "high" ? "高" : "中"}风险任务，草稿已生成，等待律师审批后渲染。`,
        );
        pushWorkflowProgress(
          ctx,
          steps,
          "若律师本条对话已要求 Word：请调用 render_document（task_id 见上，approve=true），或在桌面「审核」页签批准后导出。",
        );
      }

      return {
        ok: true,
        data: {
          taskId: intent.taskId,
          title: draft.title,
          kind: intent.kind,
          deliverableType: intent.deliverableType,
          riskLevel: intent.riskLevel,
          output: draft.output,
          matterId: intent.matterId,
          status: finalStatus,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => s.heading),
          riskFlags: bundle.riskFlags,
          missingItems: bundle.missingItems,
          claimsCount: bundle.claims.length,
          sourcesCount: bundle.sources.length,
          outputPath: draft.outputPath,
          steps,
          researchDegraded,
          citationIntegrity,
          acceptanceCriteria: draft.acceptanceCriteria,
          clarificationQuestions: draft.clarificationQuestions,
          deliveryReadiness:
            draft.clarificationQuestions && draft.clarificationQuestions.length > 0
              ? "draft_with_placeholders"
              : "draft_ready",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `工作流执行失败: ${err instanceof Error ? err.message : String(err)}`,
        data: { stepsCompleted: steps },
      };
    }
  },
};
