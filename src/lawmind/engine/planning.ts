/**
 * Engine — 步骤 1：plan / planAsync / confirm。
 */

import { resolveLawMindRoot } from "../assistants/store.js";
import { emit } from "../audit/index.js";
import { taskProgressPrefix, shortTaskIdForDisplay } from "../cases/task-display.js";
import { resolveDefaultEngineLawyerActorId } from "../engine-actor.js";
import { appendCaseProgress, appendTodayLog } from "../memory/index.js";
import { route, routeAsync, type RouteInput } from "../router/index.js";
import { updateTaskRecord } from "../tasks/index.js";
import type { TaskIntent, TaskRecord } from "../types.js";
import type { EngineContext } from "./context.js";
import { commitPlannedIntent } from "./shared.js";

export function planSync(
  ctx: EngineContext,
  instruction: string,
  opts: Omit<RouteInput, "instruction"> = {},
): TaskIntent {
  const intent = route({ instruction, ...opts });
  commitPlannedIntent(ctx, intent);
  return intent;
}

export async function planAsyncImpl(
  ctx: EngineContext,
  instruction: string,
  opts: Omit<RouteInput, "instruction"> = {},
): Promise<TaskIntent> {
  const lawMindRoot = opts.lawMindRoot ?? resolveLawMindRoot(ctx.workspaceDir);
  const intent = await routeAsync({ instruction, ...opts, lawMindRoot });
  commitPlannedIntent(ctx, intent);
  return intent;
}

export async function confirmTask(
  ctx: EngineContext,
  taskId: string,
  opts: { actorId?: string; note?: string } = {},
): Promise<TaskRecord> {
  const { workspaceDir, auditDir } = ctx;
  const record = updateTaskRecord(workspaceDir, taskId, { status: "confirmed" });
  if (!record) {
    throw new Error(`任务不存在，无法确认：${taskId}`);
  }

  const confirmActor = opts.actorId ?? resolveDefaultEngineLawyerActorId();
  await emit(auditDir, {
    taskId,
    kind: "task.confirmed",
    actor: "lawyer",
    actorId: confirmActor,
    detail: opts.note ?? "任务已确认，可进入执行阶段。",
  });
  await appendTodayLog(
    workspaceDir,
    `## 任务确认\n- 任务编号: ${shortTaskIdForDisplay(taskId)}\n- 审核人: ${confirmActor}`,
  );
  if (record.matterId) {
    await appendCaseProgress(
      workspaceDir,
      record.matterId,
      `${taskProgressPrefix(taskId)}已确认，可进入执行阶段。`,
    );
  }
  return record;
}
