import path from "node:path";
import { emit } from "../../../audit/index.js";
import { isHighSecurityMode } from "../../../policy/analysis-scripts.js";
import type { AgentTool } from "../../types.js";
import { runSandboxedAnalysisSource } from "./analysis-runner.js";
import type { AnalysisSandboxResult } from "./analysis-sandbox.js";
import type { ChartSpec } from "./chart-spec.js";
import { LM_CHART_FENCE_HINT, persistChartSpec } from "./chart-tool.js";
import {
  COMPUTE_PACK_NEXT_HINT,
  persistComputeDeliverablePack,
  type ComputeTableRef,
} from "./compute-deliverable.js";

export const COMPUTE_SOURCE_MAX_CHARS = 80_000;

export function summarizeComputeForLawyer(data: {
  tables?: Array<{ path?: string }>;
  charts?: Array<{ spec?: { title?: string } }>;
  inWorkbench?: boolean;
}): string {
  const tableCount = data.tables?.length ?? 0;
  const chartCount = data.charts?.length ?? 0;
  const firstTable = data.tables?.[0]?.path?.replace(/^.*\//, "") ?? "";
  const firstChart = data.charts?.[0]?.spec?.title ?? "";
  const bits: string[] = [];
  if (tableCount > 0) {
    bits.push(firstTable ? `已出核算对照 ${firstTable}` : `已出核算对照 ${tableCount} 张`);
  } else if (data.inWorkbench) {
    bits.push("已出核算对照");
  }
  if (chartCount > 0) {
    bits.push(firstChart ? `已出图「${firstChart}」` : `已出图 ${chartCount} 张`);
  }
  if (data.inWorkbench) {
    bits.push("已进在办");
  }
  return bits.length > 0 ? bits.join(" · ") : "已完成核算";
}

export const runCompute: AgentTool = {
  definition: {
    name: "run_compute",
    description:
      "在受控沙箱当场运行 JavaScript，用于归并表格、自定义汇总、出图。可用 Math/JSON/Date/Map 与 readTable(xlsx)、readCsv、readJson、stats、writeTable、emitChart。成功后把对照表和意见稿写入在办。失败时根据 error 改源码再调，不要把源码写进给律师的正文。法定金额与期限仍须 calculate。高安全模式不可用。",
    category: "analyze",
    parameters: {
      source: {
        type: "string",
        description: "完整 JS。顶层可用 await。不要 require/fs/fetch。",
        required: true,
      },
      purpose: {
        type: "string",
        description: "给律师看的一句话目的，例如「汇总费用并出柱状图」。不要写代码。",
      },
    },
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    if (isHighSecurityMode(ctx.workspaceDir)) {
      return { ok: false, error: "高安全模式下不可后台核算。" };
    }
    const source = typeof params.source === "string" ? params.source : "";
    if (!source.trim()) {
      return { ok: false, error: "source 不能为空。" };
    }
    if (source.length > COMPUTE_SOURCE_MAX_CHARS) {
      return { ok: false, error: `source 超过 ${COMPUTE_SOURCE_MAX_CHARS} 字符。` };
    }
    const purpose =
      typeof params.purpose === "string"
        ? params.purpose.replace(/\s+/g, " ").trim().slice(0, 80)
        : "";
    const auditDir = path.join(ctx.workspaceDir, "audit");
    try {
      const result = await runSandboxedAnalysisSource(source, ctx.workspaceDir);
      if (!result.ok) {
        await emit(auditDir, {
          taskId: ctx.sessionId,
          kind: "tool_call",
          actor: "model",
          actorId: ctx.actorId,
          detail: "run_compute fail",
        }).catch(() => undefined);
        return {
          ok: false,
          error: result.error ?? "核算失败",
          sandboxed: result.sandboxed,
          timedOut: result.timedOut,
        };
      }
      const raw = (result.data ?? {}) as AnalysisSandboxResult;
      const charts: Array<{ path: string; spec: ChartSpec }> = [];
      for (const spec of raw.charts ?? []) {
        const saved = await persistChartSpec(ctx.workspaceDir, spec);
        if (!saved.ok) {
          return { ok: false, error: saved.error, sandboxed: true };
        }
        charts.push({ path: saved.path, spec: saved.spec });
      }
      let pack:
        | {
            taskId: string;
            draftPath: string;
            title: string;
          }
        | undefined;
      let tables: ComputeTableRef[] = raw.tables ?? [];
      try {
        const persisted = await persistComputeDeliverablePack({
          workspaceDir: ctx.workspaceDir,
          projectDir: ctx.projectDir,
          matterId: ctx.matterId,
          sessionId: ctx.sessionId,
          assistantId: ctx.assistantId,
          purpose,
          tables,
          charts,
          value: raw.value,
        });
        if (persisted) {
          pack = {
            taskId: persisted.taskId,
            draftPath: persisted.draftPath,
            title: persisted.title,
          };
          tables = persisted.tables;
        }
      } catch {
        /* pack is best-effort; table/chart results still return */
      }
      const data = {
        tables,
        charts,
        logs: raw.logs ?? [],
        value: raw.value,
        hint: charts.length > 0 ? LM_CHART_FENCE_HINT : undefined,
        purpose: purpose || undefined,
        pack,
        nextHint: pack ? COMPUTE_PACK_NEXT_HINT : undefined,
        lawyerSummary: summarizeComputeForLawyer({
          tables,
          charts,
          inWorkbench: Boolean(pack),
        }),
      };
      await emit(auditDir, {
        taskId: ctx.sessionId,
        kind: "tool_call",
        actor: "model",
        actorId: ctx.actorId,
        detail: `run_compute ok tables=${data.tables.length} charts=${charts.length}`,
      }).catch(() => undefined);
      return { ok: true, data, sandboxed: true };
    } catch (err) {
      await emit(auditDir, {
        taskId: ctx.sessionId,
        kind: "tool_call",
        actor: "model",
        actorId: ctx.actorId,
        detail: "run_compute fail",
      }).catch(() => undefined);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sandboxed: true,
      };
    }
  },
};
