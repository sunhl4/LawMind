/**
 * 案件副本自动同步调度器的进程级句柄。
 *
 * 调度器在 `lawmind-local-server.ts` 启动时创建；路由层需要读它的状态
 * （`GET /api/matter-replica/scheduler`），所以这里放一个极薄的注册表，
 * 避免把 server 的启动顺序和路由耦合起来。
 */

import type { MatterReplicaSyncScheduler } from "../../../src/lawmind/matter-replica/sync-scheduler.js";

let current: MatterReplicaSyncScheduler | null = null;

export function setMatterReplicaScheduler(scheduler: MatterReplicaSyncScheduler | null): void {
  current = scheduler;
}

export function getMatterReplicaScheduler(): MatterReplicaSyncScheduler | null {
  return current;
}

/** 测试与关停用：停掉当前调度器并清空引用。 */
export function stopMatterReplicaScheduler(): void {
  current?.stop();
  current = null;
}
