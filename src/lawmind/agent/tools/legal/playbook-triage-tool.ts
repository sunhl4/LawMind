/**
 * `triage_against_playbook`：按本所剧本给合同/文书做三色分级。
 *
 * 模型只提供「每条条件的结论 + 原文引用 + 位置 + 材料路径」，引擎回读核对后再出
 * GREEN / YELLOW / RED。核不上的引用、没给结论的条件都按「未核对」处理；
 * RED 只能由律师在界面降档，工具不提供 override 入口。
 */

import { z } from "zod";
import {
  listWorkspacePlaybooks,
  loadWorkspacePlaybook,
} from "../../../deliverables/playbook-store.js";
import { triageWithVerifiedEvidence } from "../../../deliverables/playbook-triage-verify.js";
import {
  describePlaybookTriage,
  type PlaybookObservation,
} from "../../../deliverables/playbook-triage.js";
import type { AgentTool } from "../../types.js";

export const TRIAGE_AGAINST_PLAYBOOK_TOOL_NAME = "triage_against_playbook";

const observationSchema = z.object({
  criterion_id: z.string().trim().min(1).max(120),
  result: z.enum(["PASS", "FLAG", "FAIL"]),
  quote: z.string().max(4_000).optional(),
  locator: z.string().trim().max(200).optional(),
  file_path: z.string().trim().max(2_000).optional(),
  reason: z.string().max(2_000).optional(),
});

const inputSchema = z.object({
  playbook_id: z.string().trim().max(128).optional(),
  observations: z.array(observationSchema).max(100),
});

function toObservation(raw: z.infer<typeof observationSchema>): PlaybookObservation {
  const hasEvidence = Boolean(raw.quote || raw.locator || raw.file_path);
  return {
    criterionId: raw.criterion_id,
    result: raw.result,
    ...(hasEvidence
      ? {
          evidence: {
            quote: raw.quote ?? "",
            locator: raw.locator ?? "",
            ...(raw.file_path ? { filePath: raw.file_path } : {}),
          },
        }
      : {}),
    ...(raw.reason ? { reasonZh: raw.reason } : {}),
  };
}

export const triageAgainstPlaybookTool: AgentTool = {
  definition: {
    name: TRIAGE_AGAINST_PLAYBOOK_TOOL_NAME,
    description:
      "按本所剧本给合同/文书做三色分级（GREEN / YELLOW / RED）。逐条给结论时必须带原文引用 quote 与位置 locator（L12 / P2 / S1!A1）；PASS 与 FAIL 还要给 file_path（工作区相对路径），引擎会回读核对，核不上会降级为「未核对」。" +
      "没给结论的条件按未核对处理，不按通过算。RED 只能由律师在界面降档，不要自行 override，也不要把 RED 写成已通过。" +
      "工作区没有剧本时返回 basis=default（通用标准，不是本所立场），不得宣称是本所结论。",
    category: "analyze",
    parameters: {
      playbook_id: {
        type: "string",
        description: "剧本 id；工作区只有一份时可省略，多份时必须指定（错误信息会列出可用 id）",
      },
      observations: {
        type: "array",
        description:
          "每条剧本条件的结论：[{criterion_id, result: PASS|FLAG|FAIL, quote?, locator?, file_path?, reason?}]。PASS/FAIL 必须带 quote、locator 与 file_path。",
        required: true,
        items: {
          type: "object",
          properties: {
            criterion_id: { type: "string" },
            result: { type: "string", enum: ["PASS", "FLAG", "FAIL"] },
            quote: { type: "string" },
            locator: { type: "string" },
            file_path: { type: "string" },
            reason: { type: "string" },
          },
          required: ["criterion_id", "result"],
        },
      },
    },
    riskLevel: "low",
    isConcurrencySafe: true,
  },
  async execute(params, ctx) {
    const parsed = inputSchema.safeParse(params);
    if (!parsed.success) {
      return {
        ok: false,
        error: `参数不对：${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("；")}`,
      };
    }

    const requested = parsed.data.playbook_id?.trim() ?? "";
    const summaries = listWorkspacePlaybooks(ctx.workspaceDir);
    const ids = summaries.map((summary) => summary.id);
    const availableText = ids.length > 0 ? `可用剧本：${ids.join("、")}。` : "工作区还没有剧本。";

    let playbookId = requested;
    if (!playbookId) {
      if (summaries.length === 0) {
        const triage = await triageWithVerifiedEvidence({
          workspaceDir: ctx.workspaceDir,
          playbook: null,
        });
        return {
          ok: true,
          data: {
            verdict: triage.verdict,
            basis: triage.basis,
            counts: triage.counts,
            items: [],
            summary: describePlaybookTriage(triage),
            note: "工作区还没有本所剧本：本次按通用标准（basis=default），不得写成「本所立场」，也不得据此宣称 GREEN。",
          },
        };
      }
      if (summaries.length > 1) {
        return {
          ok: false,
          error: `工作区有 ${summaries.length} 份剧本，请用 playbook_id 指定。${availableText}`,
        };
      }
      playbookId = summaries[0]?.id ?? "";
    }

    const playbook = loadWorkspacePlaybook(ctx.workspaceDir, playbookId);
    if (!playbook) {
      return { ok: false, error: `没有找到剧本「${playbookId}」。${availableText}` };
    }

    const triage = await triageWithVerifiedEvidence({
      workspaceDir: ctx.workspaceDir,
      playbook,
      observations: parsed.data.observations.map(toObservation),
    });

    return {
      ok: true,
      data: {
        verdict: triage.verdict,
        basis: triage.basis,
        playbookId: playbook.id,
        playbookName: playbook.name,
        counts: triage.counts,
        evidenceVerification: triage.evidenceVerification,
        items: triage.items
          .filter((item) => item.result !== "PASS")
          .map((item) => ({
            criterionId: item.criterionId,
            title: item.title,
            result: item.result,
            ...(item.evidence?.locator ? { locator: item.evidence.locator } : {}),
            reasonZh: item.reasonZh,
          })),
        unknownCriterionIds: triage.unknownCriterionIds,
        summary: describePlaybookTriage(triage),
        ...(triage.verdict === "RED"
          ? {
              note: "RED 只能由律师在界面降档（须留理由）。不要自行改成 YELLOW，也不要在草稿里写成已通过。",
            }
          : {}),
      },
    };
  },
};
