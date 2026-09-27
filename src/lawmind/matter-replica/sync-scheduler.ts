/**
 * 协作自动同步调度器 —— 让「同事丢进材料，我这边就出现」不再需要手点按钮（差距评审 X10）。
 *
 * ## 为什么放在引擎而不是面板
 *
 * 面板会随案件切换卸载；同步必须在**服务进程**的生命周期里跑。所以这里只放**策略**
 * （何时该同步、要不要节流、失败怎么记），真正的定时器在 desktop server 里启动/停止。
 * 这样策略可以不用真等 30 秒就能测，而进程退出时也只停一处。
 *
 * ## 节流与背压
 *
 * - **总开关**：门控关闭（`matterReplica.enabled: false` 或功能键关闭）直接不启动；
 * - **单案最小间隔**：避免每轮 tick 都对同一个案件做一次全量扫描；
 * - **单飞**：上一轮还没跑完就跳过本轮，不堆积；
 * - **中继监听 + 去抖**：共享目录有动静时立刻同步，但把连续写入合并成一次；
 * - **单案失败不拖累其他案件**：错误记进 `status().lastError` 与逐案结果。
 *
 * ## 刻意不做
 *
 * 不做增量游标（`fetchOps` 已有 `afterOpId` 参数，但文件中继每次都是全量 bundle，
 * 增量要等服务端）。也不做「发现冲突自动裁决」—— 冲突仍走既有的旁路 + 人工合并。
 */

import fs from "node:fs";
import { listMatterIdsFromStorage } from "../adapters/matter-storage/index.js";
import { evaluateMatterReplicaGate } from "./feature-gate.js";
import type { SyncMaterialsResult } from "./materials-relay.js";
import { readMembership } from "./membership.js";
import { syncMatterRecordPipe } from "./relay.js";

export type SyncOutcome = {
  matterId: string;
  ok: boolean;
  pulled?: number;
  locks?: number;
  members?: number;
  downloadedFiles?: number;
  deletedLocally?: number;
  rejectedIntegrity?: number;
  error?: string;
};

export type SyncSchedulerStatus = {
  enabled: boolean;
  autoSync: boolean;
  reason: string;
  running: boolean;
  intervalMs: number;
  watchingRelay: boolean;
  relayDir: string | null;
  /** 参与自动同步的案件数（有成员名册的才算） */
  matters: number;
  /** 累计成功的案件同步次数 */
  syncs: number;
  /** 累计因节流 / 单飞而跳过的轮次 */
  skipped: number;
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastError: string | null;
};

export type SyncSchedulerOptions = {
  workspaceDir: string;
  /** 轮询间隔；默认 30s（与本地服务既有的定时器同量级）。 */
  intervalMs?: number;
  /** 同一案件两次自动同步的最小间隔；默认 15s。 */
  minMatterIntervalMs?: number;
  /** 中继目录事件的合并窗口；默认 1500ms。 */
  debounceMs?: number;
  /** 注入点：测试用假同步替代真同步。 */
  sync?: (
    workspaceDir: string,
    matterId: string,
  ) => Promise<{
    pulled: number;
    applied: { locks: number; members: number };
    materials: Pick<
      SyncMaterialsResult,
      "downloadedFiles" | "deletedLocally" | "rejectedIntegrity"
    >;
  }>;
  now?: () => number;
  onOutcome?: (outcome: SyncOutcome) => void;
};

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_MIN_MATTER_INTERVAL_MS = 15_000;
const DEFAULT_DEBOUNCE_MS = 1_500;

/** 参与自动同步的案件：有成员名册的才同步（没被邀请的案件不该被后台动）。 */
export function listAutoSyncMatters(workspaceDir: string): string[] {
  const out: string[] = [];
  for (const matterId of listMatterIdsFromStorage(workspaceDir)) {
    try {
      if (readMembership(workspaceDir, matterId)) {
        out.push(matterId);
      }
    } catch {
      /* 非法 id 跳过 */
    }
  }
  return out;
}

export class MatterReplicaSyncScheduler {
  private readonly workspaceDir: string;
  private readonly intervalMs: number;
  private readonly minMatterIntervalMs: number;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly onOutcome?: (outcome: SyncOutcome) => void;

  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<SyncOutcome[]> | null = null;
  private running = false;
  private lastMatterSyncAt = new Map<string, number>();
  private syncs = 0;
  private skipped = 0;
  private lastRunAt: number | null = null;
  private lastRunMs: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly opts: SyncSchedulerOptions) {
    this.workspaceDir = opts.workspaceDir;
    this.intervalMs = Math.max(50, opts.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.minMatterIntervalMs = Math.max(
      0,
      opts.minMatterIntervalMs ?? DEFAULT_MIN_MATTER_INTERVAL_MS,
    );
    this.debounceMs = Math.max(10, opts.debounceMs ?? DEFAULT_DEBOUNCE_MS);
    this.now = opts.now ?? (() => Date.now());
    this.onOutcome = opts.onOutcome;
  }

  private gate(): ReturnType<typeof evaluateMatterReplicaGate> {
    return evaluateMatterReplicaGate(this.workspaceDir);
  }

  /** 启动轮询（并按需监听共享中继）。门控关闭时是 no-op。 */
  start(): void {
    if (this.running) {
      return;
    }
    const gate = this.gate();
    if (!gate.enabled || !gate.autoSync) {
      return;
    }
    this.running = true;

    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        /* tick 内部已逐案兜错 */
      });
    }, this.intervalMs);
    // 不因为一个后台定时器把进程钉住（沿用 audit external anchor 的写法）
    this.timer.unref?.();

    this.watchRelay(gate.sharedRelayDir);
  }

  /**
   * 共享文件夹刚选好时重挂监听。已经在跑就只换监听目录；门控关了就停。
   */
  rearm(): void {
    const gate = this.gate();
    if (!gate.enabled || !gate.autoSync) {
      if (this.running) {
        this.stop();
      }
      return;
    }
    if (!this.running) {
      this.start();
      return;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* 已关闭 */
      }
      this.watcher = null;
    }
    this.watchRelay(gate.sharedRelayDir);
  }

  /** 停轮询 + 停监听 + 清去抖。可重复调用。 */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* 已关闭 */
      }
      this.watcher = null;
    }
  }

  /**
   * 监听共享中继目录：同事一丢文件就同步，但把连续写入合并成一次。
   * `fs.watch` 在个别平台/目录上会抛错（网络盘、权限），失败只降级为纯轮询。
   */
  private watchRelay(relayDir: string | undefined): void {
    if (!relayDir) {
      return;
    }
    try {
      this.watcher = fs.watch(relayDir, { recursive: true }, () => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          void this.tick().catch(() => {
            /* 同上 */
          });
        }, this.debounceMs);
        this.debounceTimer.unref?.();
      });
      this.watcher.on?.("error", () => {
        /* 监听失效则只剩轮询，不影响同步本身 */
      });
      // 与定时器同样处理：不让一个后台监听把进程钉住，妨碍干净退出
      (this.watcher as unknown as { unref?: () => void }).unref?.();
    } catch {
      this.watcher = null;
    }
  }

  /**
   * 跑一轮：逐案同步，单案失败不影响其他案件。
   * 上一轮未结束时直接返回上一轮的 promise（单飞，不堆积）。
   */
  async tick(): Promise<SyncOutcome[]> {
    if (this.inFlight) {
      this.skipped += 1;
      return this.inFlight;
    }
    const gate = this.gate();
    if (!gate.enabled || !gate.autoSync) {
      return [];
    }
    this.inFlight = this.runPass().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runPass(): Promise<SyncOutcome[]> {
    const startedAt = this.now();
    const outcomes: SyncOutcome[] = [];
    const matters = listAutoSyncMatters(this.workspaceDir);

    for (const matterId of matters) {
      const last = this.lastMatterSyncAt.get(matterId);
      if (last !== undefined && startedAt - last < this.minMatterIntervalMs) {
        this.skipped += 1;
        continue;
      }
      this.lastMatterSyncAt.set(matterId, startedAt);
      const outcome = await this.syncOne(matterId);
      outcomes.push(outcome);
      if (outcome.ok) {
        this.syncs += 1;
      } else {
        this.lastError = outcome.error ?? "unknown sync error";
      }
      this.onOutcome?.(outcome);
    }

    this.lastRunAt = this.now();
    this.lastRunMs = this.lastRunAt - startedAt;
    return outcomes;
  }

  private async syncOne(matterId: string): Promise<SyncOutcome> {
    try {
      if (this.opts.sync) {
        const r = await this.opts.sync(this.workspaceDir, matterId);
        return {
          matterId,
          ok: true,
          pulled: r.pulled,
          locks: r.applied.locks,
          members: r.applied.members,
          downloadedFiles: r.materials.downloadedFiles,
          deletedLocally: r.materials.deletedLocally.length,
          rejectedIntegrity: r.materials.rejectedIntegrity.length,
        };
      }
      const r = await syncMatterRecordPipe(this.workspaceDir, matterId);
      return {
        matterId,
        ok: true,
        pulled: r.pulled,
        locks: r.applied.locks,
        members: r.applied.members,
        downloadedFiles: r.materials.downloadedFiles,
        deletedLocally: r.materials.deletedLocally.length,
        rejectedIntegrity: r.materials.rejectedIntegrity.length,
      };
    } catch (err) {
      return { matterId, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  status(): SyncSchedulerStatus {
    const gate = this.gate();
    return {
      enabled: gate.enabled,
      autoSync: gate.autoSync,
      reason: gate.reason,
      running: this.running,
      intervalMs: this.intervalMs,
      watchingRelay: this.watcher !== null,
      relayDir: gate.sharedRelayDir ?? null,
      matters: listAutoSyncMatters(this.workspaceDir).length,
      syncs: this.syncs,
      skipped: this.skipped,
      lastRunAt: this.lastRunAt === null ? null : new Date(this.lastRunAt).toISOString(),
      lastRunMs: this.lastRunMs,
      lastError: this.lastError,
    };
  }
}

/** 便捷工厂：与 audit external anchor 同形（start/stop/status）。 */
export function startMatterReplicaAutoSync(opts: SyncSchedulerOptions): MatterReplicaSyncScheduler {
  const scheduler = new MatterReplicaSyncScheduler(opts);
  scheduler.start();
  return scheduler;
}
