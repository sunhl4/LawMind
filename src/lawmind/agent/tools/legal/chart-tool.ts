import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveWorkspaceRelativePath } from "../../../runtime/workspace-path.js";
import type { AgentTool } from "../../types.js";
import { parseChartSpec, type ChartSpec } from "./chart-spec.js";
import { renderChartSvg } from "./chart-svg.js";

export const LM_CHART_FENCE_HINT =
  "请在助手正文用 ```lm-chart 围栏原样贴回上面的 spec JSON，以便律师复核图表。不要改写成像素图或外部链接。";

export async function persistChartSpec(
  workspaceDir: string,
  spec: ChartSpec,
): Promise<
  { ok: true; path: string; spec: ChartSpec; svg: string } | { ok: false; error: string }
> {
  const id = randomUUID().slice(0, 8);
  const rel = `artifacts/charts/${id}.json`;
  const resolved = resolveWorkspaceRelativePath(workspaceDir, rel);
  if (!resolved.ok) {
    return { ok: false, error: "不允许写到工作区外。" };
  }
  await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
  await fs.writeFile(resolved.abs, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return { ok: true, path: resolved.rel, spec, svg: renderChartSvg(spec) };
}

export const renderChart: AgentTool = {
  definition: {
    name: "render_chart",
    description:
      "按声明式 JSON 规格生成可审计图表（bar/line/pie/stacked_bar）。写入 artifacts/charts/<id>.json，并返回完整 spec。助手正文必须用 lm-chart 围栏贴回 spec。",
    category: "analyze",
    parameters: {
      spec: {
        type: "object",
        description: "图表规格：title、type、categories、series、可选 unit/source/notes",
        required: true,
      },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    const parsed = parseChartSpec(params.spec ?? params);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }
    const saved = await persistChartSpec(ctx.workspaceDir, parsed.spec);
    if (!saved.ok) {
      return { ok: false, error: saved.error };
    }
    return {
      ok: true,
      data: {
        path: saved.path,
        spec: saved.spec,
        svg: saved.svg,
        hint: LM_CHART_FENCE_HINT,
      },
    };
  },
};
