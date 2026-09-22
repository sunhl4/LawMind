/**
 * apply_surgical_edits 工具（单份 + 跨文书一致改入口）。
 *
 * 从 engine-pipeline-tools.ts 拆出来：那个文件已是冻结大文件（行数棘轮），
 * 新能力应自己成模块而不是把它撞大。入口名与行为不变。
 */

import {
  generateRedlineAfterWrite,
  persistDraft,
  prepareRedlineBaselineBeforeWrite,
  readDraft,
  resetRedlineBaselineFromDraft,
} from "../../../drafts/index.js";
import { terminologyWarningsPatch } from "../../../drafts/terminology-adapt.js";
import type { AgentTool } from "../../types.js";
import { executeCrossDocumentEdits } from "./cross-document-edits-tool.js";
import {
  asNonEmptyString,
  asOptionalString,
  blockHeavyPipelineIfClarificationPending,
  resolveDefaultRenderTaskId,
  resolveDraftTaskIdForUpdate,
} from "./engine-tool-shared.js";

// apply_surgical_edits — 字/词级 find/replace 落改（合同审阅）
// ─────────────────────────────────────────────

export const applySurgicalEdits: AgentTool = {
  definition: {
    name: "apply_surgical_edits",
    description:
      "对已 seed 的合同草稿做精确 find/replace。跨度硬门禁由引擎执行（过长/整句 find 会被跳过或拒绝；细则见本轮 Craft Skill）。须附 craft_check.deferred（无缓办则 []）。成功后看 redlinePending，≥1 再 render_tracked_draft。短路径勿用 update_draft.sections 改正文。省略 edits 时可回落 redline-plan.json。传 task_ids 则走跨文书一致改：先全批预检，预检不过整批零落改。",
    category: "draft",
    parameters: {
      task_id: {
        type: "string",
        description: "草稿 taskId；省略时使用会话关联草稿或最近草稿",
      },
      task_ids: {
        type: "array",
        description:
          '跨文书一致改：要一起改的多份草稿 taskId。同一 find/replace 对全批生效；先全批预检（锚点过宽、或同一锚点在某份里多处命中却未声明 occurrences:"all"，即整批停、零落改）；命中 0 处的文书记入变更清单。当事人名/术语统一替换请对该条传 occurrences:"all"。',
      },
      edits: {
        type: "array",
        description:
          "[{ find, replace, note? }]；每处 find=最短锚定。非锁定路径可省略并用 redline-plan sidecar。",
        required: false,
      },
      craft_check: {
        type: "object",
        description: "必填。缓办写入 deferred（无缓办则 []）。缺失视为工具错误，本回合不得结束。",
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
      // 跨文书一致改：给了 task_ids 就走全批路径（同一锚定规则、先预检再落笔）。
      const batchTaskIds = Array.isArray(params.task_ids)
        ? params.task_ids.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      if (batchTaskIds.length > 0) {
        return executeCrossDocumentEdits({ params, ctx, taskIds: batchTaskIds, craftCheck });
      }
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
        const { writeRedlinePlan, readRedlinePlan } =
          await import("../../../drafts/redline-plan.js");
        const prior = readRedlinePlan(ctx.workspaceDir, taskId);
        writeRedlinePlan(ctx.workspaceDir, {
          taskId,
          items: applied.applied.map((row) => ({
            find: row.find,
            replace: row.replace,
            note: row.note,
          })),
          skipped: applied.skipped,
          updatedAt: new Date().toISOString(),
          craftCheckAttached: Boolean(craftCheck) || prior?.craftCheckAttached === true,
          writerDeferred: craftCheck?.deferred ?? prior?.writerDeferred,
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
      // 「未采纳」= 落不下的输入条（原文找不到 / 待收窄 / 碎片化）；最短改动由引擎重算，
      // 不再是「跨度硬门禁拒绝」这一种原因。
      const spanSkipped = applied.skipped.filter((s) => s.reason.includes("未找到"));
      const otherSkipped = applied.skipped.filter((s) => !s.reason.includes("未找到"));
      // 术语自适应兜底：这次落改是否把另一套当事人称谓带了进来。
      const terminologyWarnings = applied.terminologyWarnings;
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
          ...terminologyWarningsPatch(terminologyWarnings),
          ...(editsFromPlan ? { editsFromPlan: true as const } : {}),
          message:
            redlinePending >= 1
              ? [
                  `已落改 ${applied.applied.length} 处，redlinePending=${redlinePending}。`,
                  editsFromPlan ? "（edits 来自 redline-plan sidecar）" : "",
                  spanSkipped.length
                    ? `${spanSkipped.length} 处 find 未在正文命中——请用 analyze 可见的精确原文补交。`
                    : "",
                  otherSkipped.length
                    ? `${otherSkipped.length} 处未落改（${otherSkipped[0]?.reason.slice(0, 40) ?? ""}）。`
                    : "",
                  craftWarns.length
                    ? `Craft 提示 ${craftWarns.length} 条：可按需再收窄或补 deferred。`
                    : spanSkipped.length
                      ? ""
                      : "可 render_tracked_draft。",
                  terminologyWarnings.length
                    ? `术语提示：本次写入出现本文未定义的当事人叫法（${terminologyWarnings.map((w) => w.token).join("、")}），请改用本文术语后再导出。`
                    : "",
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
