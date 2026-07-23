/**
 * GET /api/metrics/team-growth — Wave DoD「内测指标表」快照
 * POST /api/metrics/team-growth/baseline — 冻结当前窗口为基线
 */

import { z } from "zod";
import {
  buildTeamGrowthDashboard,
  captureTeamGrowthBaseline,
} from "../../../src/lawmind/metrics/team-growth-dashboard.js";
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

  return false;
}
