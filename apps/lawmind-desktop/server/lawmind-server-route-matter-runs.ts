/**
 * 案件运行「等待超时」的律师处理：再等一段，或不再等这一步。
 *
 * 只接受已经升级的等待步骤；路由本身不猜执行器、不推进后续步骤。
 * 跳过之后 run 处于可继续状态，由下一轮 tick / 自动办件恢复推进。
 */

import { z } from "zod";
import { isValidMatterId } from "../../../src/lawmind/cases/matter-id.js";
import { resolveEscalatedMatterRunWait } from "../../../src/lawmind/platform/matter-run-store.js";
import {
  MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS,
  MATTER_RUN_WAIT_EXTEND_MAX_DAYS,
} from "../../../src/lawmind/platform/matter-run-wait.js";
import { isInvalidRequestBodyError, parseJsonBodyZod } from "./lawmind-api-parse.js";
import { sendJsonError } from "./lawmind-api-error.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const decideSchema = z.object({
  action: z.enum(["extend", "skip"]),
  /** 只对 extend 生效；上限与默认值在落盘层收口。 */
  days: z
    .number()
    .int()
    .min(1)
    .max(MATTER_RUN_WAIT_EXTEND_MAX_DAYS)
    .optional(),
});

export function handleMatterRunRoutes({
  ctx,
  req,
  res,
  pathname,
  c,
}: LawmindRouteContext): boolean | Promise<boolean> {
  const match = pathname.match(/^\/api\/matter-runs\/([^/]+)\/([^/]+)\/steps\/([^/]+)\/wait$/);
  if (!match) {
    return false;
  }
  const matterId = decodeURIComponent(match[1] ?? "");
  const runId = decodeURIComponent(match[2] ?? "");
  const stepId = decodeURIComponent(match[3] ?? "");
  if (!isValidMatterId(matterId) || !SAFE_ID.test(runId) || !SAFE_ID.test(stepId)) {
    sendJsonError(res, 400, "invalid_target", "案件、运行或步骤编号格式不正确。", c);
    return true;
  }
  if (req.method !== "POST") {
    sendJsonError(res, 405, "method_not_allowed", "只接受 POST。", c);
    return true;
  }
  return (async () => {
    let body: z.infer<typeof decideSchema>;
    try {
      body = await parseJsonBodyZod(req, decideSchema);
    } catch (err) {
      if (isInvalidRequestBodyError(err)) {
        sendJsonError(res, 400, "invalid_body", err.issues.join(" "), c);
        return true;
      }
      throw err;
    }

    const result = resolveEscalatedMatterRunWait(ctx.workspaceDir, {
      matterId,
      runId,
      stepId,
      action: body.action,
      ...(body.days !== undefined ? { days: body.days } : {}),
    });
    if (!result.ok) {
      const notFound = result.reason === "run_not_found" || result.reason === "step_not_found";
      sendJson(
        res,
        notFound ? 404 : 409,
        { ok: false, reason: result.reason, error: decideFailureText(result.reason) },
        c,
      );
      return true;
    }
    const extendedDays =
      body.action === "extend" ? (body.days ?? MATTER_RUN_WAIT_EXTEND_DEFAULT_DAYS) : undefined;
    sendJson(
      res,
      200,
      {
        ok: true,
        ...(extendedDays !== undefined ? { days: extendedDays } : {}),
        run: {
          runId: result.run.runId,
          matterId: result.run.matterId,
          status: result.run.status,
        },
        step: {
          stepId: result.step.stepId,
          status: result.step.status,
          ...(result.step.wait ? { wait: result.step.wait } : {}),
        },
      },
      c,
    );
    return true;
  })();
}

function decideFailureText(reason: string): string {
  switch (reason) {
    case "run_not_found":
      return "这次案件运行已经不在。";
    case "step_not_found":
      return "这一步已经不在这次运行里。";
    case "step_not_waiting":
      return "这一步已经不在等待状态。";
    case "step_not_escalated":
      return "这一步还没到需要你拍板的时候。";
    default:
      return "这一步现在不能这样处理。";
  }
}
