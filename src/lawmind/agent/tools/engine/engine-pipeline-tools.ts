import { linkDraftToDeliverable } from "../../../application/services/deliverable-service.js";
import { validateDraftAgainstSpec } from "../../../deliverables/index.js";
import {
  generateRedlineAfterWrite,
  persistDraft,
  prepareRedlineBaselineBeforeWrite,
  readDraft,
  resetRedlineBaselineFromDraft,
  validateDraftCitationsAgainstBundle,
} from "../../../drafts/index.js";
import { readResearchSnapshot } from "../../../drafts/research-snapshot.js";
import { isOutlineGatedDeliverable } from "../../../reasoning/research-draft-gates.js";
import { outlineLooksApproved } from "../../../research/outline-hitl.js";
import { readResearchOutline } from "../../../research/outline-store.js";
import {
  evaluateResearchEvidenceGate,
  RESEARCH_EVIDENCE_GATE_REFUSAL,
} from "../../../research/research-evidence-gate.js";
import { isDemoCorpusResult } from "../../../retrieval/authority-gap.js";
import { route } from "../../../router/keyword-route.js";
import {
  ensureTaskRecord,
  readTaskRecord,
  taskIntentFromRecordOnly,
} from "../../../tasks/index.js";
import type { ArtifactSection, TaskIntent } from "../../../types.js";
import type { AgentContext, AgentTool } from "../../types.js";
import { formatRenderToolError } from "../render-tool-messages.js";
import {
  asNonEmptyString,
  asOptionalString,
  blockHeavyPipelineIfClarificationPending,
  canDraftWithoutResearch,
  DEMO_CORPUS_DRAFT_REFUSAL,
  buildAdaptersFromEnv,
  getEngine,
  MAX_AUDIENCE_LENGTH,
  MAX_INSTRUCTION_LENGTH,
  MAX_TITLE_LENGTH,
  resolveDefaultRenderTaskId,
  resolveMatterId,
  resolveTemplateId,
  shouldRefuseDraftOnDemoCorpus,
} from "./engine-tool-shared.js";

/** Rebuild task record when deep_research left snapshot/outline but no tasks/*.json. */
function recoverIntentFromResearchArtifacts(
  workspaceDir: string,
  reuseTaskId: string,
  instruction: string,
  opts?: { assistantId?: string; matterId?: string },
): TaskIntent | undefined {
  const snapshot = readResearchSnapshot(workspaceDir, reuseTaskId);
  const outline = readResearchOutline(workspaceDir, reuseTaskId);
  if (!snapshot && !outline) {
    return undefined;
  }
  const routed = route({
    instruction: instruction || snapshot?.query || outline?.title || "研究续跑",
    matterId: opts?.matterId,
    ...(outline?.deliverableType ? { deliverableType: outline.deliverableType } : {}),
  });
  const intent: TaskIntent = { ...routed, taskId: reuseTaskId };
  ensureTaskRecord(workspaceDir, intent, { assistantId: opts?.assistantId });
  return intent;
}

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
    // Clarification pending: research stays allowed (gather facts before write/export).
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

      const bundle = await engine.research(intent, { signal: ctx.abortSignal });
      if (bundle.claims.length === 0 && bundle.sources.length === 0) {
        if (canDraftWithoutResearch(intent)) {
          const { formatCitationGateCoach } = await import("../../../drafts/citation-craft.js");
          return {
            ok: true,
            data: {
              taskId: intent.taskId,
              sourcesCount: 0,
              claimsCount: 0,
              researchDegraded: true,
              riskFlags: bundle.riskFlags,
              missingItems: bundle.missingItems,
              hint: [
                "检索为空，但可继续 execute_workflow 或 draft_document 生成待审核草稿（含占位符）。",
                formatCitationGateCoach("本次无来源；结论须标【待核实】，勿臆造法条。"),
              ].join("\n"),
            },
          };
        }
        const { formatCitationGateCoach } = await import("../../../drafts/citation-craft.js");
        return {
          ok: false,
          error: [
            "检索未返回任何来源或要点。请检查模型配置，或在案件档案中补充资料后重试。",
            formatCitationGateCoach("无 bundle 来源；可改检索词或补充案卷后再 research_task。"),
          ].join("\n"),
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
            ...(s.demo ? { demo: true as const } : {}),
          })),
          ...(bundle.sources.some((s) => s.demo) ||
          bundle.riskFlags.some((f) => f.includes("演示语料"))
            ? { demoCorpus: true as const }
            : {}),
        },
      };
    } catch (err) {
      const { formatCitationGateCoach } = await import("../../../drafts/citation-craft.js");
      return {
        ok: false,
        error: [
          `检索失败: ${err instanceof Error ? err.message : String(err)}`,
          formatCitationGateCoach("检索异常；可降级起草并标【待核实】，勿假装已有权威来源。"),
        ].join("\n"),
      };
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
      "更新工作区已有草稿的正文（title / summary / sections）。用于审核台「需修改」后的改稿：只更新同一条 drafts/<taskId>.json，不会新建 taskId。task_id 可省略（使用当前关联草稿）。合同正文请做最小必要修改（只改必须改的字词）；可设 contract_edit_baseline_path 指向原合同 .doc/.docx 以导出 Word 审阅修订（无需先转格式）。",
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
      contract_review_edits: {
        type: "array",
        description:
          "合同审查结构化改稿计划：[{find,replace,priority?:P0|P1|P2,mode?:apply|opinion_only,reason?}]。精确锚点作为主路径，意见正文正则仅兼容。",
      },
      contract_edit_baseline_path: {
        type: "string",
        description:
          "原合同相对工作区路径（.doc 或 .docx，无需先转格式），用于带修订 Word 导出基线",
      },
      contract_edit_mode: {
        type: "string",
        description: "surgical（默认，字/句级）或 section（整节对比）",
      },
      seed_sections_from_baseline: {
        type: "boolean",
        description: "为 true 时从原合同 Word 基线按段落重填 sections（覆盖现有正文）",
      },
    },
    // Draft revision during chat should not interrupt the lawyer; final delivery stays on 文书台.
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
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
      const { parseContractReviewEditProposals } =
        await import("../../../drafts/contract-review-edits.js");
      const contractReviewEdits =
        params.contract_review_edits !== undefined
          ? parseContractReviewEditProposals(params.contract_review_edits)
          : undefined;
      const baselinePath = asOptionalString(
        params.contract_edit_baseline_path,
        "contract_edit_baseline_path",
        512,
      );
      const modeRaw = asOptionalString(params.contract_edit_mode, "contract_edit_mode", 32);
      const editMode =
        modeRaw === "section"
          ? ("section" as const)
          : modeRaw === "surgical"
            ? ("surgical" as const)
            : undefined;
      const seedFromBaseline =
        params.seed_sections_from_baseline === true ||
        params.seed_sections_from_baseline === "true";
      if (
        title === undefined &&
        summary === undefined &&
        sections === undefined &&
        contractReviewEdits === undefined &&
        baselinePath === undefined &&
        editMode === undefined &&
        !seedFromBaseline
      ) {
        return { ok: false, error: "至少提供 title、summary、sections 或合同基线参数之一" };
      }
      let next = {
        ...draft,
        ...(title !== undefined ? { title } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(sections !== undefined ? { sections } : {}),
        ...(contractReviewEdits !== undefined ? { contractReviewEdits } : {}),
      };
      let contractBaselineWarnings: string[] = [];
      {
        const { enrichDraftWithContractEditBaseline, stampContractEditBaselineIfNeeded } =
          await import("../../../drafts/contract-edit-baseline.js");
        const extraPaths = baselinePath ? [baselinePath] : [];
        const seedSections: boolean | undefined = seedFromBaseline
          ? true
          : sections !== undefined
            ? false
            : baselinePath
              ? undefined
              : false;
        if (baselinePath || editMode || seedFromBaseline || draft.contractEdit) {
          const enriched = await enrichDraftWithContractEditBaseline({
            workspaceDir: ctx.workspaceDir,
            projectDir: ctx.projectDir,
            draft: next,
            extraPaths,
            mode: editMode ?? draft.contractEdit?.mode ?? "surgical",
            seedSections,
            pins: ctx.contextPins,
          });
          next = enriched.draft;
          contractBaselineWarnings = enriched.warnings;
          if (editMode && next.contractEdit) {
            next = {
              ...next,
              contractEdit: { ...next.contractEdit, mode: editMode },
            };
          }
        } else {
          next = stampContractEditBaselineIfNeeded({
            workspaceDir: ctx.workspaceDir,
            projectDir: ctx.projectDir,
            draft: next,
          });
        }
      }
      if (next.taskId !== taskId) {
        return { ok: false, error: "taskId 不可变更" };
      }
      let amplitudeCraftSignals: Array<{ level: string; code: string; message: string }> = [];
      let amplitudeGateDecision:
        | {
            gate: "reasoning_gate";
            decision: "allow";
            reason: string;
            category: "judgment_soft";
          }
        | undefined;
      if (sections !== undefined) {
        const {
          evaluateSurgicalEditGate,
          evaluateSurgicalEditGateHard,
          attachRewriteAmplitudeMeta,
          auditSurgicalEditGateSoft,
          craftSignalsFromAmplitudeGate,
          surgicalAmplitudeEnforceEnabled,
        } = await import("../../../drafts/surgical-edit-gate.js");
        if (surgicalAmplitudeEnforceEnabled()) {
          const hard = evaluateSurgicalEditGateHard({ beforeDraft: draft, afterDraft: next });
          if (!hard.ok) {
            return {
              ok: false,
              error: hard.message,
              data: {
                code: hard.code,
                absCharDelta: hard.absCharDelta,
                ratio: hard.ratio,
                gateDecision: {
                  gate: "reasoning_gate",
                  decision: "block",
                  reason: hard.message,
                  category: "safety_hard",
                },
              },
            };
          }
        }
        const gate = evaluateSurgicalEditGate({ beforeDraft: draft, afterDraft: next });
        auditSurgicalEditGateSoft({
          workspaceDir: ctx.workspaceDir,
          taskId,
          matterId: draft.matterId,
          gate,
        });
        next = attachRewriteAmplitudeMeta(next, gate);
        amplitudeCraftSignals = craftSignalsFromAmplitudeGate(gate);
        if (gate.exceededSoftThreshold) {
          amplitudeGateDecision = {
            gate: "reasoning_gate",
            decision: "allow",
            reason: gate.message ?? "rewrite_amplitude_soft",
            category: "judgment_soft",
          };
        }
      }
      prepareRedlineBaselineBeforeWrite(ctx.workspaceDir, taskId);
      persistDraft(ctx.workspaceDir, next);
      let redlinePlanPreview:
        | {
            itemCount: number;
            skippedCount: number;
            items: Array<{ find: string; replace: string }>;
          }
        | undefined;
      if (
        ctx.wordRevisionTurn !== true &&
        ctx.mailContractTurn !== true &&
        next.deliverableType === "contract.review"
      ) {
        try {
          const { writeRedlinePlanFromOpinion } =
            await import("../../../drafts/opinion-redline-plan.js");
          const plan = writeRedlinePlanFromOpinion(ctx.workspaceDir, next);
          if (plan.items.length > 0) {
            redlinePlanPreview = {
              itemCount: plan.items.length,
              skippedCount: plan.skipped.length,
              items: plan.items.slice(0, 12).map((row) => ({
                find: row.find,
                replace: row.replace,
              })),
            };
          }
        } catch {
          /* best-effort */
        }
      }
      const redline = generateRedlineAfterWrite(ctx.workspaceDir, taskId);
      if (next.matterId) {
        try {
          const tr = readTaskRecord(ctx.workspaceDir, taskId);
          linkDraftToDeliverable(ctx.workspaceDir, next, tr ?? undefined);
        } catch {
          // 写侧失败不阻断正文保存
        }
      }
      const acceptance = validateDraftAgainstSpec(next);
      // update_draft revises an existing draft's body without re-running retrieval.
      // If the original research snapshot was demo-only, surface a non-blocking
      // warning so the lawyer knows the underlying authority hits were not vetted
      // and the revised draft must not be delivered as-is.
      const snapshot = readResearchSnapshot(ctx.workspaceDir, taskId);
      const demoCorpus = snapshot ? isDemoCorpusResult(snapshot) : false;
      const redlinePending = redline.ok
        ? redline.proposal.hunks.filter((h) => h.status === "pending").length
        : 0;
      const emptyRedlineWarning =
        Boolean(next.contractEdit) && sections !== undefined && redlinePending === 0
          ? "正文未产生任何 Redline 修订（redlinePending=0）。禁止调用 render_tracked_draft；请对 sections 做可核验的字/词级修改（可依据邮件或附件批注）后再试。"
          : undefined;
      const baselineWarning =
        contractBaselineWarnings.length > 0 ? contractBaselineWarnings.join("；") : undefined;
      const amplitudeWarning = amplitudeCraftSignals[0]?.message;
      const warning =
        [baselineWarning, emptyRedlineWarning, amplitudeWarning].filter(Boolean).join("；") ||
        undefined;
      return {
        ok: true,
        data: {
          taskId: next.taskId,
          title: next.title,
          sectionsCount: next.sections.length,
          reviewStatus: next.reviewStatus,
          acceptanceReady: acceptance.ready,
          draftPath: `drafts/${taskId}.json`,
          redlinePending,
          ...(redlinePlanPreview ? { redlinePlan: redlinePlanPreview } : {}),
          ...(amplitudeCraftSignals.length > 0 ? { craftSignals: amplitudeCraftSignals } : {}),
          ...(contractBaselineWarnings.length > 0
            ? {
                contractBaselineWarnings,
              }
            : {}),
          ...(emptyRedlineWarning
            ? {
                gateDecision: {
                  gate: "redline_hunks_gate",
                  decision: "block",
                  reason: "redlinePending=0 after section update；空修订不得导出",
                  category: "safety_hard",
                },
              }
            : amplitudeGateDecision
              ? { gateDecision: amplitudeGateDecision }
              : {}),
          ...(warning ? { warning } : {}),
          ...(demoCorpus
            ? {
                demoCorpus: true as const,
                demoCorpusWarning:
                  "本草稿的检索快照仅命中演示语料，引用未经正式权威库核验。修订后请勿直接交付，需补齐正式权威来源或由律师手工核对法条后再渲染。",
              }
            : {}),
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
// apply_surgical_edits — 字/词级 find/replace 落改（合同审阅）
// ─────────────────────────────────────────────

export const applySurgicalEdits: AgentTool = {
  definition: {
    name: "apply_surgical_edits",
    description:
      "对已 seed 的合同草稿做精确 find/replace 落改。跨度硬门禁：能改几个字就只改几个字；段内只改有问题的句子；含句读的 find≤12 字；整句/整段删写会被跳过/拒绝。条数不限（全文可很多处）。附 craft_check。勿把整节塞进 update_draft.sections。成功后返回 redlinePending；≥1 后再 render_tracked_draft。非锁定路径若省略 edits，可回落 drafts/<taskId>.redline-plan.json（意见推荐措辞编译结果）。",
    category: "draft",
    parameters: {
      task_id: {
        type: "string",
        description: "草稿 taskId；省略时使用会话关联草稿或最近草稿",
      },
      edits: {
        type: "array",
        description:
          "[{ find, replace, note? }]；每处 find=最短锚定。非锁定路径可省略并用 redline-plan sidecar。条数不限，勿整句/整段",
        required: false,
      },
      craft_check: {
        type: "object",
        description:
          "建议。自评：{ coverage, restraint, deferred:[{issue,reason}], notes? }——覆盖度/是否守住字词级跨度/缓办理由",
      },
      summary: {
        type: "string",
        description: "可选：已改点 + 缓办说明（写入草稿 summary）",
      },
      contract_edit_baseline_path: {
        type: "string",
        description: "若草稿尚无 contractEdit，可传入基线路径并自动 seed sections",
      },
    },
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const { applySurgicalTextEdits } = await import("../../../drafts/apply-surgical-edits.js");
      const { parseCraftCheckInput, evaluateCraftCheck } =
        await import("../../../drafts/contract-redline-craft.js");
      const craftCheck = parseCraftCheckInput(params.craft_check);
      let taskId: string;
      try {
        taskId = resolveDraftTaskIdForUpdate(params, ctx);
      } catch {
        const fallback = resolveDefaultRenderTaskId(ctx, ctx.workspaceDir);
        if (!fallback) {
          return {
            ok: false,
            error: "缺少 task_id，且当前无关联草稿。请先 draft_document/update_draft（seed）。",
          };
        }
        taskId = fallback;
      }
      let edits;
      let editsFromPlan = false;
      try {
        const { resolveSurgicalEditsForApply } =
          await import("../../../drafts/resolve-surgical-edits.js");
        const resolved = resolveSurgicalEditsForApply({
          editsArg: params.edits,
          workspaceDir: ctx.workspaceDir,
          taskId,
          wordRevisionTurn: ctx.wordRevisionTurn,
          mailContractTurn: ctx.mailContractTurn,
        });
        edits = resolved.edits;
        editsFromPlan = resolved.fromPlan;
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          data: { taskId, code: "surgical_edits_missing" },
        };
      }
      let draft = readDraft(ctx.workspaceDir, taskId);
      if (!draft) {
        return { ok: false, error: `找不到草稿 ${taskId}` };
      }
      const baselinePath = asOptionalString(
        params.contract_edit_baseline_path,
        "contract_edit_baseline_path",
        512,
      );
      const bodyChars = (draft.sections ?? []).reduce(
        (n, s) => n + (s.body?.trim().length ?? 0),
        0,
      );
      const needsSeed = draft.sections.length === 0 || bodyChars < 40;
      if (baselinePath || needsSeed || !draft.contractEdit) {
        const { enrichDraftWithContractEditBaseline } =
          await import("../../../drafts/contract-edit-baseline.js");
        const { wordFilePinRelPaths } =
          await import("../../../drafts/paired-review-deliverable.js");
        const enriched = await enrichDraftWithContractEditBaseline({
          workspaceDir: ctx.workspaceDir,
          projectDir: ctx.projectDir,
          draft,
          extraPaths: [
            ...(baselinePath ? [baselinePath] : []),
            ...wordFilePinRelPaths(ctx.contextPins),
          ],
          mode: draft.contractEdit?.mode ?? "surgical",
          // Never pass undefined: that still auto-seeds "thin" bodies and can
          // desync amplitude comparison if the model also rewrites summary.
          seedSections: needsSeed,
          pins: ctx.contextPins,
        });
        draft = enriched.draft;
        if (draft.clarificationQuestions?.length) {
          draft = { ...draft, clarificationQuestions: undefined };
        }
        persistDraft(ctx.workspaceDir, draft);
      }
      {
        const { preparePairedRedlineBody } = await import("../../../drafts/paired-review-body.js");
        const prepared = await preparePairedRedlineBody({
          workspaceDir: ctx.workspaceDir,
          projectDir: ctx.projectDir,
          draft,
          wordRevisionTurn: ctx.wordRevisionTurn === true,
          pins: ctx.contextPins,
        });
        draft = prepared.draft;
        if (prepared.swapped) {
          persistDraft(ctx.workspaceDir, draft);
          resetRedlineBaselineFromDraft(ctx.workspaceDir, taskId);
        }
      }
      // Amplitude gate for this tool is per-edit (find/replace). Do not run the
      // whole-draft rewrite gate — seed+summary noise was falsely blocking Δ~1 万字.
      const applied = applySurgicalTextEdits({ sections: draft.sections, edits });
      if (!applied.ok) {
        const spanHard = applied.code === "span_too_wide";
        return {
          ok: false,
          error: applied.error,
          data: {
            code: applied.code,
            taskId,
            skipped: applied.skipped ?? [],
            ...(spanHard
              ? {
                  gateDecision: {
                    gate: "surgical_span_gate",
                    decision: "block",
                    reason: "find/replace 跨度超过最短锚定硬门禁；请拆成字/词级后重试（条数不限）",
                    category: "safety_hard",
                  },
                }
              : {}),
          },
        };
      }
      const summary =
        params.summary !== undefined
          ? asNonEmptyString(params.summary, "summary", 48_000)
          : undefined;
      const next = {
        ...draft,
        sections: applied.sections,
        ...(summary !== undefined ? { summary } : {}),
      };
      // Lock baseline once, then regenerate hunks from baseline → current body.
      // Recompute (do not overwrite with this-batch-only hunks) so multi-call
      // apply_surgical_edits keeps every accumulated edit in the export proposal.
      prepareRedlineBaselineBeforeWrite(ctx.workspaceDir, taskId);
      persistDraft(ctx.workspaceDir, next);
      try {
        const { writeRedlinePlan } = await import("../../../drafts/redline-plan.js");
        writeRedlinePlan(ctx.workspaceDir, {
          taskId,
          items: applied.applied.map((row) => ({
            find: row.find,
            replace: row.replace,
            note: row.note,
          })),
          skipped: applied.skipped,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        /* plan sidecar is best-effort */
      }
      const redline = generateRedlineAfterWrite(ctx.workspaceDir, taskId);
      if (!redline.ok) {
        return {
          ok: false,
          error: `外科落改已写入草稿，但 Redline 提案生成失败：${redline.error}`,
          data: { code: redline.error, taskId, appliedCount: applied.applied.length },
        };
      }
      const proposal = redline.proposal;
      const redlinePending = proposal.hunks.filter((h) => h.status === "pending").length;
      const craftSignals = [...applied.craftSignals, ...evaluateCraftCheck(craftCheck)];
      const craftWarns = craftSignals.filter((s) => s.level === "warn");
      const spanSkipped = applied.skipped.filter((s) => s.reason.includes("跨度硬门禁"));
      return {
        ok: true,
        data: {
          taskId,
          appliedCount: applied.applied.length,
          applied: applied.applied,
          skipped: applied.skipped,
          redlinePending,
          craftCheck: craftCheck ?? null,
          craftSignals,
          draftPath: `drafts/${taskId}.json`,
          ...(editsFromPlan ? { editsFromPlan: true as const } : {}),
          message:
            redlinePending >= 1
              ? [
                  `已落改 ${applied.applied.length} 处，redlinePending=${redlinePending}。`,
                  editsFromPlan ? "（edits 来自 redline-plan sidecar）" : "",
                  spanSkipped.length
                    ? `${spanSkipped.length} 处因跨度硬门禁被跳过——请收窄 find 后补交（条数不限）。`
                    : "",
                  craftWarns.length
                    ? `Craft 提示 ${craftWarns.length} 条：可按需再收窄或补 deferred。`
                    : spanSkipped.length
                      ? ""
                      : "可 render_tracked_draft。",
                ]
                  .filter(Boolean)
                  .join("")
              : `已落改 ${applied.applied.length} 处，但 redlinePending=0；请检查 find 是否相对 baseline 有实质变化后重试。`,
          ...(redlinePending === 0
            ? {
                gateDecision: {
                  gate: "redline_hunks_gate",
                  decision: "block",
                  reason: "redlinePending=0 after surgical edits；空修订不得导出",
                  category: "safety_hard",
                },
              }
            : {}),
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `外科落改失败: ${err instanceof Error ? err.message : String(err)}`,
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
      "基于检索结果生成文书草稿。会产出结构化的文书（包含标题、章节、引用等），并自动持久化到工作区。返回 data.citationIntegrity：将草稿章节 citations 与检索 bundle 来源 ID 对照（ok / missingSourceIds / sectionsWithIssues）。合规/调研/培训类可传 task_id 复用 deep_research 已落盘的大纲与检索快照。",
    category: "draft",
    parameters: {
      instruction: { type: "string", description: "原始工作指令", required: true },
      title: { type: "string", description: "文书标题（可选，自动推断）" },
      audience: { type: "string", description: "目标受众" },
      matter_id: { type: "string", description: "案件 ID" },
      task_id: {
        type: "string",
        description:
          "可选：复用已有任务 ID（如 deep_research 返回的 taskId），以读取已落盘大纲/检索快照，避免新建任务丢失 HITL 状态",
      },
      template_id: {
        type: "string",
        description:
          "模板 ID（如 word/legal-memo-default、ppt/client-brief-default、upload/firm-brief）",
      },
      contract_edit_baseline_path: {
        type: "string",
        description:
          "原合同相对工作区或项目根的路径（.doc 或 .docx，无需先转格式）；合同改稿时写入 contractEdit 基线并尽量按段落切正文",
      },
      contract_review_edits: {
        type: "array",
        description:
          "合同审查结构化改稿计划：[{find,replace,priority?:P0|P1|P2,mode?:apply|opinion_only,reason?}]。只传原文可精确命中的最短锚点。",
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
      const baselinePath = asOptionalString(
        params.contract_edit_baseline_path,
        "contract_edit_baseline_path",
        512,
      );
      const reuseTaskId =
        asOptionalString(params.task_id, "task_id", 128) ?? (ctx.linkedTaskId?.trim() || undefined);

      let intent: TaskIntent;
      if (reuseTaskId) {
        const rec = readTaskRecord(ctx.workspaceDir, reuseTaskId);
        if (!rec) {
          const recovered = recoverIntentFromResearchArtifacts(
            ctx.workspaceDir,
            reuseTaskId,
            instruction,
            { assistantId: ctx.assistantId, matterId },
          );
          if (!recovered) {
            return {
              ok: false,
              error: `未找到任务 ${reuseTaskId}。请去掉 task_id 重新规划，或先 deep_research / plan_task。`,
            };
          }
          intent = { ...recovered, instruction };
        } else {
          intent = {
            ...taskIntentFromRecordOnly(rec),
            instruction,
          };
        }
        const mid = resolveMatterId(params.matter_id, matterId ?? intent.matterId);
        if (mid) {
          intent = { ...intent, matterId: mid };
        }
        if (audience) {
          intent = { ...intent, audience };
        }
        if (templateId) {
          intent = { ...intent, templateId };
        }
      } else {
        intent = await engine.planAsync(instruction, {
          audience,
          matterId,
        });
      }
      if (ctx.wordRevisionTurn) {
        intent = {
          ...intent,
          kind: "draft.word",
          deliverableType: "contract.general",
          clarificationQuestions: undefined,
        };
      }

      if (intent.requiresConfirmation) {
        await engine.confirm(intent.taskId, { actorId: ctx.actorId });
      }

      let bundle = isOutlineGatedDeliverable(intent.deliverableType)
        ? readResearchSnapshot(ctx.workspaceDir, intent.taskId)
        : undefined;
      if (!bundle) {
        bundle = await engine.research(intent, { signal: ctx.abortSignal });
      }
      // Outline-only drafts may proceed with weak evidence; body expansion must not.
      const persistedOutline = isOutlineGatedDeliverable(intent.deliverableType)
        ? readResearchOutline(ctx.workspaceDir, intent.taskId)
        : undefined;
      const willExpandResearchBody =
        !isOutlineGatedDeliverable(intent.deliverableType) ||
        persistedOutline?.status === "approved" ||
        outlineLooksApproved(instruction);
      if (willExpandResearchBody) {
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
              recoverable: true,
              existingTaskId: intent.taskId,
              restart_from: "research",
              demoCorpus: bundle ? isDemoCorpusResult(bundle) : false,
              gateDecision: evidenceGate.gateDecision,
              nextActions: evidenceGate.nextActions,
              nextStep: evidenceGate.nextStep,
            },
          };
        }
      }
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
      if (
        willExpandResearchBody &&
        shouldRefuseDraftOnDemoCorpus(intent) &&
        isDemoCorpusResult(bundle)
      ) {
        return {
          ok: false,
          error: DEMO_CORPUS_DRAFT_REFUSAL,
          data: {
            demoCorpus: true,
            recoverable: true,
            existingTaskId: intent.taskId,
            restart_from: "research",
            gateDecision: {
              gate: "demo_corpus_gate",
              decision: "block",
              reason: "high-risk draft with demo-only authority hits",
            },
            nextActions: [
              "enable_web_search",
              "open_settings_models",
              "open_settings_doctor",
              "restart_research",
            ],
          },
        };
      }
      {
        const { runAutoStatuteTrial } = await import("../../../research/auto-statute-trial.js");
        const { loadMemoryContext } = await import("../../../memory/index.js");
        const trial = await runAutoStatuteTrial({
          intent,
          bundle,
          memory: await loadMemoryContext(ctx.workspaceDir, { matterId: intent.matterId }),
          adapters: buildAdaptersFromEnv(ctx.workspaceDir, {
            allowWebSearch: ctx.allowWebSearch === true,
          }),
          signal: ctx.abortSignal,
          wordRevisionTurn: ctx.wordRevisionTurn,
          mailContractTurn: ctx.mailContractTurn,
        });
        bundle = trial.bundle;
      }
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
              gateDecision: {
                gate: "training_desense_gate",
                decision: "block",
                reason: msg,
              },
            },
          };
        }
        throw draftErr;
      }
      const { parseContractReviewEditProposals } =
        await import("../../../drafts/contract-review-edits.js");
      const contractReviewEdits = parseContractReviewEditProposals(params.contract_review_edits);
      if (contractReviewEdits.length > 0 && draft.deliverableType === "contract.review") {
        draft = { ...draft, contractReviewEdits };
        persistDraft(ctx.workspaceDir, draft);
      }
      const citationIntegrity = validateDraftCitationsAgainstBundle(draft, bundle);
      let contractBaselineWarnings: string[] = [];
      let pinnedWordBaseline = Boolean(baselinePath);
      let pairedDeliverable = false;
      {
        const { isWordRevisionTurn } =
          await import("../../../platform/word-revision-instruction.js");
        const { isMailContractFastPathInstruction } =
          await import("../../../platform/mail-contract-short-path-instruction.js");
        const { extractDocxRelativePathsFromText, enrichDraftWithContractEditBaseline } =
          await import("../../../drafts/contract-edit-baseline.js");
        const { pinsIncludeWordFile, wordFilePinRelPaths } =
          await import("../../../drafts/paired-review-deliverable.js");
        const wordRev =
          ctx.wordRevisionTurn === true ||
          isWordRevisionTurn({ instruction, pins: ctx.contextPins });
        const extracted = extractDocxRelativePathsFromText(instruction);
        pairedDeliverable =
          !wordRev &&
          ctx.mailContractTurn !== true &&
          !isMailContractFastPathInstruction(instruction) &&
          draft.deliverableType === "contract.review" &&
          pinsIncludeWordFile(ctx.contextPins);
        pinnedWordBaseline = Boolean(
          baselinePath || wordRev || extracted.length > 0 || pairedDeliverable,
        );
        if (pinnedWordBaseline) {
          const { persistDraft } = await import("../../../drafts/index.js");
          const extraPaths = [
            ...(baselinePath ? [baselinePath] : []),
            ...extracted,
            ...(pairedDeliverable ? wordFilePinRelPaths(ctx.contextPins) : []),
          ];
          const enriched = await enrichDraftWithContractEditBaseline({
            workspaceDir: ctx.workspaceDir,
            projectDir: ctx.projectDir,
            draft,
            instruction,
            bundle,
            extraPaths,
            seedSections: wordRev || Boolean(baselinePath) || undefined,
            pins: ctx.contextPins,
          });
          draft = enriched.draft;
          contractBaselineWarnings = enriched.warnings;
          if (draft.clarificationQuestions?.length) {
            draft = { ...draft, clarificationQuestions: undefined };
          }
          persistDraft(ctx.workspaceDir, draft);
        }
      }

      let redlinePlanPreview:
        | {
            itemCount: number;
            skippedCount: number;
            items: Array<{ find: string; replace: string }>;
          }
        | undefined;
      if (pairedDeliverable && ctx.wordRevisionTurn !== true && ctx.mailContractTurn !== true) {
        try {
          const { writeRedlinePlanFromOpinion } =
            await import("../../../drafts/opinion-redline-plan.js");
          const plan = writeRedlinePlanFromOpinion(ctx.workspaceDir, draft);
          if (plan.items.length > 0) {
            redlinePlanPreview = {
              itemCount: plan.items.length,
              skippedCount: plan.skipped.length,
              items: plan.items.slice(0, 12).map((row) => ({
                find: row.find,
                replace: row.replace,
              })),
            };
          }
        } catch {
          /* best-effort sidecar */
        }
      }

      const openClarifications = pinnedWordBaseline ? undefined : draft.clarificationQuestions;
      return {
        ok: true,
        data: {
          taskId: draft.taskId,
          title: draft.title,
          output: draft.output,
          templateId: draft.templateId,
          deliverableType: draft.deliverableType,
          contractEdit: draft.contractEdit,
          sectionsCount: draft.sections.length,
          sections: draft.sections.map((s) => ({
            heading: s.heading,
            bodyPreview: s.body.slice(0, 100),
            citationsCount: s.citations?.length ?? 0,
          })),
          ...(contractBaselineWarnings.length > 0
            ? {
                contractBaselineWarnings,
                warning: contractBaselineWarnings.join("；"),
              }
            : {}),
          reviewStatus: draft.reviewStatus,
          matterId: draft.matterId,
          citationIntegrity,
          acceptanceCriteria: draft.acceptanceCriteria,
          clarificationQuestions: openClarifications,
          deliveryReadiness:
            openClarifications && openClarifications.length > 0
              ? "draft_with_placeholders"
              : "draft_ready",
          ...(pairedDeliverable ? { pairedDeliverable: true as const } : {}),
          ...(redlinePlanPreview ? { redlinePlan: redlinePlanPreview } : {}),
          ...(isDemoCorpusResult(bundle) ? { demoCorpus: true as const } : {}),
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
      "将草稿渲染为本地 Word 等交付物，供律师改稿或再吩咐一轮。可指定 task_id；若省略，则优先使用律师在桌面工作台为当前会话关联的草稿（linkedTaskId），否则回退到最近一份草稿。本地出稿不对外发；发给对方请用 prepare_outbound_mail。可选 approve=true 给草稿盖「已取用」戳。",
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
          "默认 false：草稿未通过 Deliverable-First 出稿检查时拒绝渲染。仅在律师已确认草稿完整、知道接受占位符的前提下设为 true。",
      },
    },
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
      // Acceptance gate bypass is a distinct lawyer decision from approval.
      // approve=true only sets the review status to approved; it must NOT silently
      // bypass the Deliverable-First acceptance gate. The lawyer must explicitly
      // pass bypass_acceptance_gate=true to accept placeholders / blockers.
      const bypassGate = params.bypass_acceptance_gate === true;
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
      if (ctx.wordRevisionTurn) {
        return {
          ok: false,
          error:
            "本回合是原 Word 改稿：禁止 render_document（会按模板重建，也不会写到原文件目录）。请用 render_tracked_draft，在源文件同目录写出带审阅痕迹的 Word。",
          data: { taskId: draft.taskId, code: "word_revision_use_tracked" },
        };
      }

      // Acceptance Gate：先拦后盖戳，避免未出稿就把草稿锁成 approved、律师改不了。
      const acceptance = validateDraftAgainstSpec(draft);
      if (!acceptance.ready && !bypassGate) {
        const gateErr = `草稿未通过出稿检查（blockers=${acceptance.blockerCount}, placeholders=${acceptance.placeholderCount}）。请先补齐缺失内容再渲染；若律师已确认接受占位符，请使用 bypass_acceptance_gate=true 重新调用。`;
        return {
          ok: false,
          error: formatRenderToolError(gateErr),
          data: {
            taskId: draft.taskId,
            title: draft.title,
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

      let approvedDraft = draft;
      if (approvedDraft.reviewStatus !== "approved" && shouldApprove) {
        approvedDraft = await engine.review(approvedDraft, {
          actorId: ctx.actorId,
          status: "approved",
          note: approvalNote ?? "律师在当前对话中明确同意导出最终文书。",
        });
      }

      const result = await engine.render(approvedDraft, {
        strictGates: bypassGate ? false : undefined,
        citationGateStrict: bypassGate ? false : undefined,
      });
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

// ─────────────────────────────────────────────
// render_tracked_draft — 原合同基线 + Word 审阅痕迹
// ─────────────────────────────────────────────

export const renderTrackedDraft: AgentTool = {
  definition: {
    name: "render_tracked_draft",
    description:
      "将合同正文草稿按 Redline 提案导出带 Word 原生审阅痕迹的**审阅稿**（拷贝原 Word，保留原格式与原有修订，只叠加新修订）。默认写入**源文件同一目录**，文件名为「原名_日期_01.docx」（同日再导为 02）。不写 taskId 后缀，不自动打开 Word。待澄清未决时拒绝执行。",
    category: "draft",
    parameters: {
      task_id: {
        type: "string",
        description: "正文草稿 taskId；省略时使用会话关联草稿",
      },
      matter_id: {
        type: "string",
        description: "案件 ID；省略时从草稿/会话/基线路径推断",
      },
      allow_empty_redline: {
        type: "boolean",
        description:
          "默认 false：合同基线改稿在 redline hunks=0 时拒绝导出。仅在律师明确接受「无新修订、仅保留原格式拷贝」时设为 true。",
      },
    },
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const blocked = blockHeavyPipelineIfClarificationPending(ctx);
    if (blocked) {
      return blocked;
    }
    try {
      const taskId =
        params.task_id === undefined
          ? resolveDefaultRenderTaskId(ctx, ctx.workspaceDir)
          : asNonEmptyString(params.task_id, "task_id", 128);
      if (!taskId) {
        return { ok: false, error: "缺少 task_id，且当前无关联草稿。" };
      }
      let draft = readDraft(ctx.workspaceDir, taskId);
      if (!draft) {
        return { ok: false, error: `找不到草稿 ${taskId}` };
      }
      if (ctx.wordRevisionTurn && !draft.contractEdit) {
        const { enrichDraftWithContractEditBaseline } =
          await import("../../../drafts/contract-edit-baseline.js");
        const { persistDraft } = await import("../../../drafts/index.js");
        const enriched = await enrichDraftWithContractEditBaseline({
          workspaceDir: ctx.workspaceDir,
          projectDir: ctx.projectDir,
          draft,
          extraPaths: [],
          seedSections: false,
          pins: ctx.contextPins,
        });
        draft = enriched.draft;
        persistDraft(ctx.workspaceDir, draft);
      }
      const { readRedlineProposal } = await import("../../../drafts/redline-proposal.js");
      const { renderDocxWithTrackedChanges } =
        await import("../../../artifacts/render-docx-tracked.js");
      const { matterIdFromWorkspaceRelativePath } =
        await import("../../../artifacts/matter-word-delivery.js");
      const { planTrackedWordDelivery } =
        await import("../../../artifacts/word-revision-delivery.js");
      const proposal = readRedlineProposal(ctx.workspaceDir, taskId);
      const proposals = (proposal?.hunks ?? []).filter((h) => h.status !== "rejected");
      {
        const { evaluateTrackedRenderHunkGate } =
          await import("../../../drafts/tracked-render-hunk-gate.js");
        const hunkGate = evaluateTrackedRenderHunkGate({
          hasContractEdit: Boolean(draft.contractEdit),
          proposalCount: proposals.length,
          allowEmpty: params.allow_empty_redline === true,
        });
        if (!hunkGate.ok) {
          return {
            ok: false,
            error: hunkGate.message,
            data: {
              taskId,
              code: hunkGate.code,
              redlinePending: hunkGate.proposalCount,
              minHunks: hunkGate.minHunks,
              gateDecision: {
                gate: "redline_hunks_gate",
                decision: "block",
                reason: "contractEdit requires applied surgical redline hunks；空修订不得导出",
                category: "safety_hard",
              },
            },
          };
        }
      }
      const pathMod = await import("node:path");
      const fsMod = await import("node:fs");
      const baselineRel = draft.contractEdit?.baselineRelativePath?.trim();
      let matterId: string | undefined;
      try {
        matterId = resolveMatterId(params.matter_id, ctx.matterId);
      } catch {
        // Disk-only legacy folder names that fail isValidMatterId but already exist under cases/.
        const raw = (
          typeof params.matter_id === "string" ? params.matter_id : ctx.matterId
        )?.trim();
        if (
          raw &&
          !raw.includes("..") &&
          !raw.includes("/") &&
          !raw.includes("\\") &&
          fsMod.existsSync(pathMod.join(ctx.workspaceDir, "cases", raw))
        ) {
          matterId = raw;
        }
      }
      matterId =
        matterId ||
        draft.matterId?.trim() ||
        (baselineRel ? matterIdFromWorkspaceRelativePath(baselineRel) : undefined);
      const planned = planTrackedWordDelivery({
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        baselineRel,
        baselineRoot: draft.contractEdit?.baselineRoot,
        matterId,
        fallbackBasename: baselineRel
          ? pathMod.basename(baselineRel)
          : `${draft.title?.trim() || "合同"}.docx`,
        pins: ctx.contextPins,
      });
      if (ctx.wordRevisionTurn && !planned.baselineAbs) {
        return {
          ok: false,
          error:
            "找不到原 Word，无法在源文件同目录写出带审阅痕迹的审阅稿。请确认对话已钉选该文件，且桌面已选择项目文件夹。",
          data: { taskId, code: "word_revision_baseline_missing" },
        };
      }
      const outDir = planned.outDir;
      const outputFileName = planned.outputFileName;
      const preferContract =
        (draft.deliverableType ?? "").startsWith("contract.") || Boolean(draft.contractEdit);
      let result = await renderDocxWithTrackedChanges({
        draft,
        outputDir: outDir,
        proposals,
        workspaceDir: ctx.workspaceDir,
        projectDir: ctx.projectDir,
        pins: ctx.contextPins,
        templateVariant: preferContract ? "contractReview" : undefined,
        outputFileName,
        requireContractBaseline: ctx.wordRevisionTurn === true || Boolean(draft.contractEdit),
      });
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          data: { code: result.code, taskId },
        };
      }
      const { shouldAutoRetryXmlQa, applyNarrowedPlanOnce } =
        await import("../../../drafts/xml-qa-auto-retry.js");
      let xmlQa: { ok: boolean; insCount: number; delCount: number; warning?: string } | undefined;
      try {
        const { qaTrackedDocxXml } = await import("../../../drafts/tracked-xml-qa.js");
        xmlQa = await qaTrackedDocxXml(result.outputPath, result.appliedHunks ?? 0);
      } catch {
        xmlQa = undefined;
      }
      let xmlQaAutoRetried = false;
      let xmlQaRetry:
        | { action: "narrow_and_reapply"; edits: Array<{ find: string; replace: string }> }
        | undefined;
      if (xmlQa && !xmlQa.ok && shouldAutoRetryXmlQa(ctx)) {
        const retry = applyNarrowedPlanOnce({ workspaceDir: ctx.workspaceDir, draft });
        if (retry.attempted && retry.draft && retry.appliedCount > 0) {
          prepareRedlineBaselineBeforeWrite(ctx.workspaceDir, taskId);
          persistDraft(ctx.workspaceDir, retry.draft);
          const redline = generateRedlineAfterWrite(ctx.workspaceDir, taskId);
          if (redline.ok) {
            draft = retry.draft;
            const retryProposals = (redline.proposal.hunks ?? []).filter(
              (h) => h.status !== "rejected",
            );
            const retryResult = await renderDocxWithTrackedChanges({
              draft,
              outputDir: outDir,
              proposals: retryProposals,
              workspaceDir: ctx.workspaceDir,
              projectDir: ctx.projectDir,
              pins: ctx.contextPins,
              templateVariant: preferContract ? "contractReview" : undefined,
              outputFileName,
              requireContractBaseline: Boolean(draft.contractEdit),
            });
            if (retryResult.ok) {
              result = retryResult;
              xmlQaAutoRetried = true;
              try {
                const { qaTrackedDocxXml } = await import("../../../drafts/tracked-xml-qa.js");
                xmlQa = await qaTrackedDocxXml(result.outputPath, result.appliedHunks ?? 0);
              } catch {
                xmlQa = undefined;
              }
            }
          }
        }
        if (xmlQa && !xmlQa.ok) {
          try {
            const { readRedlinePlan, buildXmlQaRetryHint } =
              await import("../../../drafts/redline-plan.js");
            xmlQaRetry = buildXmlQaRetryHint(readRedlinePlan(ctx.workspaceDir, taskId));
          } catch {
            xmlQaRetry = { action: "narrow_and_reapply", edits: [] };
          }
        }
      } else if (
        xmlQa &&
        !xmlQa.ok &&
        ctx.wordRevisionTurn !== true &&
        ctx.mailContractTurn !== true
      ) {
        try {
          const { readRedlinePlan, buildXmlQaRetryHint } =
            await import("../../../drafts/redline-plan.js");
          xmlQaRetry = buildXmlQaRetryHint(readRedlinePlan(ctx.workspaceDir, taskId));
        } catch {
          xmlQaRetry = { action: "narrow_and_reapply", edits: [] };
        }
      }
      const rel = pathMod.relative(ctx.workspaceDir, result.outputPath).replace(/\\/g, "/");
      const degraded = result.mode === "plain_fallback" || Boolean(result.degraded);
      const qaWarning = xmlQa && !xmlQa.ok ? xmlQa.warning : undefined;
      return {
        ok: true,
        data: {
          taskId,
          matterId: matterId || undefined,
          outputPath: result.outputPath,
          outputRelativePath: rel.startsWith("..") ? result.outputPath : rel,
          mode: result.mode,
          baselineSource: result.baselineSource,
          degraded: degraded || undefined,
          conversionTool: result.conversionTool,
          conversionFidelity: result.conversionFidelity,
          warning: [result.warning, qaWarning].filter(Boolean).join(" ") || undefined,
          appliedHunks: result.appliedHunks,
          xmlQa,
          ...(xmlQaRetry ? { xmlQaRetry } : {}),
          ...(xmlQaAutoRetried ? { xmlQaAutoRetried: true as const } : {}),
          openWord: false,
          message: [
            degraded
              ? `【降级】${result.warning || "未能完好保留原格式/审阅痕迹或未能写入全部修订"}（请自行用 Word 打开核对，不会自动打开）：${rel}`
              : `已写入源文件同目录审阅修订稿（保留原格式；新修改以修订显示；请自行用 Word 打开，不会自动打开）：${rel}`,
            typeof result.appliedHunks === "number" ? `已叠加修订条数：${result.appliedHunks}` : "",
            result.conversionTool ? `基线转换：${result.conversionTool}` : "",
            xmlQaAutoRetried ? "XML 未见修订时已内部收窄并重导一次。" : "",
            qaWarning ?? "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `导出审阅稿失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
