/**
 * GET /api/metrics/team-growth — Wave DoD「内测指标表」快照
 * POST /api/metrics/team-growth/baseline — 冻结当前窗口为基线
 * GET /api/metrics/north-star — 无干预 / 一次通过 / lint 逃逸
 * GET /api/metrics/context-pressure — 整理 / 退让 / 承前分叉（缺来源 → present:false）
 */

import { z } from "zod";
import {
  buildTeamGrowthDashboard,
  captureTeamGrowthBaseline,
} from "../../../src/lawmind/metrics/team-growth-dashboard.js";
import { persistNorthStarSnapshot } from "../../../src/lawmind/metrics/north-star.js";
import { persistNorthStarTrend } from "../../../src/lawmind/metrics/north-star-trend.js";
import {
  buildLawyerDeskDashboard,
  readMatterHealthMetrics,
} from "../../../src/lawmind/metrics/lawyer-dashboard.js";
import { summarizeContextPressure } from "../../../src/lawmind/metrics/context-pressure.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

function parseWindowDays(raw: string | null): number {
  if (!raw?.trim()) {
    return 30;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return 30;
  }
  return Math.max(1, Math.min(365, n));
}

const baselineBodySchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
  note: z.string().max(500).optional(),
});

export async function handleMetricsRoutes({
  ctx,
  pathname,
  req,
  res,
  url,
  c,
}: LawmindRouteContext): Promise<boolean> {
  const { workspaceDir } = ctx;

  if (pathname === "/api/metrics/north-star" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...persistNorthStarSnapshot(workspaceDir) }, c);
    return true;
  }

  /**
   * 上下文压力：整理 / 退让 / 承前分叉的结果。
   * 口径见 `src/lawmind/metrics/context-pressure.ts`——缺来源时 `present: false`，
   * 消费方**不得**把缺失读成 0（「从没压过」与「压了 100 次一次没退让」必须区分）。
   */
  if (pathname === "/api/metrics/context-pressure" && req.method === "GET") {
    sendJson(res, 200, { ok: true, ...summarizeContextPressure(workspaceDir) }, c);
    return true;
  }

  if (pathname === "/api/metrics/north-star-trend" && req.method === "GET") {
    const windowDays = parseWindowDays(url.searchParams.get("windowDays"));
    sendJson(res, 200, { ok: true, ...persistNorthStarTrend(workspaceDir, { windowDays }) }, c);
    return true;
  }

  if (pathname === "/api/metrics/team-growth" && req.method === "GET") {
    const windowDays = parseWindowDays(url.searchParams.get("windowDays"));
    const dashboard = await buildTeamGrowthDashboard(workspaceDir, { windowDays });
    sendJson(res, 200, { ok: true, ...dashboard }, c);
    return true;
  }

  if (pathname === "/api/metrics/team-growth/baseline" && req.method === "POST") {
    try {
      const body = await parseJsonBodyZod(req, baselineBodySchema);
      const result = await captureTeamGrowthBaseline(workspaceDir, {
        windowDays: body.windowDays,
        note: body.note,
      });
      sendJson(
        res,
        200,
        {
          ok: true,
          ...result.dashboard,
          baselineFile: result.baseline,
        },
        c,
      );
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJson(res, 400, { ok: false, error: "invalid request" }, c);
        return true;
      }
      throw err;
    }
    return true;
  }

  if (pathname === "/api/metrics/lawyer-dashboard" && req.method === "GET") {
    const matterId = url.searchParams.get("matterId")?.trim() ?? "";
    const taskId = url.searchParams.get("taskId")?.trim() ?? undefined;
    if (matterId) {
      const metrics = readMatterHealthMetrics(workspaceDir, matterId, { taskId });
      sendJson(res, 200, { ok: true, metrics }, c);
    } else {
      const dashboard = buildLawyerDeskDashboard(workspaceDir);
      sendJson(res, 200, { ok: true, dashboard }, c);
    }
    return true;
  }

  return false;
}
