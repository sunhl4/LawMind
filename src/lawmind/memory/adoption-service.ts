/**
 * Memory Adoption Service — W5。
 *
 * 把 LawMind 所有 Markdown 记忆写入收敛到一个显式服务里：
 *   - `suggest({ scope, kind, summary, target, autoAdopt? })`
 *   - `adopt(suggestionId)` / `dismiss(suggestionId)` / `listPending(opts?)`
 *
 * Scope 维度：firm / lawyer / client / matter / playbook / opponent / project / assistant。
 * 每条 suggestion 落到 `workspace/memory-adoption/suggestions.jsonl`。已被引擎自动
 * 写入的条目（如检索高价值 claim → CASE 核心争点）会同时入队但 `state="auto_adopted"`，
 * 律师可在 Inspector（W6）一键撤回。
 *
 * 与历史 `learning/suggestion-queue.ts` 的关系：
 *   - learning/suggestion-queue：仅审核标签的 deferred adoption；W5 起会镜像写入本服务，
 *     方便 Inspector 用统一界面查看。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appendJsonl, rewriteJsonl, withExclusiveFileLock } from "../adapters/matter-storage/io.js";
import { emit } from "../audit/index.js";

export const MEMORY_SCOPES = [
  "firm",
  "lawyer",
  "client",
  "matter",
  "playbook",
  "opponent",
  "project",
  "assistant",
] as const;

export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_ADOPTION_KINDS = [
  "case.core_issue",
  "case.risk_note",
  "case.task_goal",
  "case.progress",
  "case.artifact",
  "playbook.clause_learning",
  "lawyer.profile_learning",
  "assistant.profile_section",
  "firm.preference",
  "client.profile_note",
  "opponent.note",
  "project.note",
  "historical.knowledge",
  "lawyer.habit_pattern",
  "review_label",
  "source.annotation",
] as const;

export type MemoryAdoptionKind = (typeof MEMORY_ADOPTION_KINDS)[number];

export type MemoryAdoptionState = "pending" | "adopted" | "auto_adopted" | "dismissed";

const recordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  state: z.enum(["pending", "adopted", "auto_adopted", "dismissed"]),
  scope: z.enum(MEMORY_SCOPES),
  kind: z.enum(MEMORY_ADOPTION_KINDS),
  /** 关联资源（matterId / lawyerId / clientId 等），便于 Inspector 分组。 */
  targetId: z.string().optional(),
  /** 可选：写入的 markdown 行（auto_adopted 时已落盘，pending 时为待落盘草稿）。 */
  payload: z.string(),
  /** 可选：来源 task / source link，便于审计回溯。 */
  sourceTaskId: z.string().optional(),
  /** 可选：触发来源（engine / lawyer / agent / migration）。 */
  origin: z.enum(["engine", "lawyer", "agent", "migration", "external"]).default("engine"),
  /** 可选：律师备注（dismiss 原因等）。 */
  note: z.string().optional(),
  /** 落盘时间（adopted/auto_adopted/dismissed 才有）。 */
  resolvedAt: z.string().optional(),
});

export type MemoryAdoptionRecord = z.infer<typeof recordSchema>;

function suggestionsFile(workspaceDir: string): string {
  return path.join(workspaceDir, "memory-adoption", "suggestions.jsonl");
}

function readAllSync(workspaceDir: string): MemoryAdoptionRecord[] {
  const file = suggestionsFile(workspaceDir);
  if (!existsSync(file)) {
    return [];
  }
  const raw = readFileSync(file, "utf8");
  if (!raw.trim()) {
    return [];
  }
  const out: MemoryAdoptionRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = recordSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) {
        out.push(parsed.data);
      }
    } catch {
      // skip bad line
    }
  }
  return out;
}

async function readAll(workspaceDir: string): Promise<MemoryAdoptionRecord[]> {
  return readAllSync(workspaceDir);
}

/**
 * 进程内互斥：suggest（append）与 adopt/dismiss/mark（读-改-全量重写）必须串行，
 * 否则 adopt 的 rewrite 会用旧快照覆盖并发 suggest 的 append，静默丢记录。
 * （桌面单进程写入模型下足够；跨进程写不在当前部署形态内。）
 */
let adoptionMutationQueue: Promise<unknown> = Promise.resolve();

function withAdoptionMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = adoptionMutationQueue.then(fn, fn);
  adoptionMutationQueue = next.catch(() => undefined);
  return next;
}

/**
 * suggestions.jsonl 的跨进程排他锁：append 与「读-改-全量重写」共用同一把
 * O_EXCL 文件锁（对齐 approvals/queue 的既有模式），避免 rewrite 覆盖并发 append。
 */
function withSuggestionsFileLock<T>(workspaceDir: string, fn: () => T): T {
  return withExclusiveFileLock(`${suggestionsFile(workspaceDir)}.lock`, fn);
}

function rewriteAllLocked(workspaceDir: string, records: MemoryAdoptionRecord[]): void {
  rewriteJsonl(suggestionsFile(workspaceDir), recordSchema, records);
}

/** 锁内 append 一条 suggestion（schema 校验 + 目录保证）。 */
function appendOneSync(workspaceDir: string, rec: MemoryAdoptionRecord): void {
  withSuggestionsFileLock(workspaceDir, () => {
    appendJsonl(suggestionsFile(workspaceDir), recordSchema, rec);
  });
}

export type SuggestInput = {
  scope: MemoryScope;
  kind: MemoryAdoptionKind;
  payload: string;
  targetId?: string;
  sourceTaskId?: string;
  origin?: MemoryAdoptionRecord["origin"];
  note?: string;
};

export type SuggestOptions = {
  /** true 时立即写入 markdown（由调用方 writer 完成）；记录 state 为 auto_adopted。 */
  autoAdopt?: boolean;
};

/**
 * 创建一条记忆采纳建议。
 *
 * 注意：实际把 markdown 写到磁盘的动作由调用方负责（调用方知道 scope→file 的映射）。
 * 本服务只负责显式记录"曾经发生过这么一条建议"，让 Inspector 与审计能追溯。
 */
export async function suggestMemoryAdoption(
  workspaceDir: string,
  auditDir: string,
  input: SuggestInput,
  opts?: SuggestOptions,
): Promise<MemoryAdoptionRecord> {
  return withAdoptionMutationLock(async () => {
    const now = new Date().toISOString();
    const rec: MemoryAdoptionRecord = {
      id: randomUUID(),
      createdAt: now,
      state: opts?.autoAdopt ? "auto_adopted" : "pending",
      scope: input.scope,
      kind: input.kind,
      targetId: input.targetId,
      payload: input.payload,
      sourceTaskId: input.sourceTaskId,
      origin: input.origin ?? "engine",
      note: input.note,
      resolvedAt: opts?.autoAdopt ? now : undefined,
    };
    appendOneSync(workspaceDir, rec);
    await emit(auditDir, {
      taskId: input.sourceTaskId ?? "system",
      kind: opts?.autoAdopt ? "memory.adoption_auto_adopted" : "memory.adoption_suggested",
      actor: input.origin === "lawyer" ? "lawyer" : "system",
      detail: JSON.stringify({
        suggestionId: rec.id,
        scope: rec.scope,
        kind: rec.kind,
        targetId: rec.targetId,
      }),
    });
    return rec;
  });
}

/**
 * 律师在 Inspector 上手动 adopt：调用方 writer 完成实际落盘。
 */
export async function adoptMemorySuggestion(
  workspaceDir: string,
  auditDir: string,
  id: string,
  writer: (rec: MemoryAdoptionRecord) => Promise<void> | void,
  opts?: { actorId?: string; note?: string },
): Promise<{ ok: boolean; error?: string; record?: MemoryAdoptionRecord }> {
  return withAdoptionMutationLock(async () => {
    // 1) 锁内读 + 校验（跨进程 CAS 的读侧）
    const check = withSuggestionsFileLock(workspaceDir, () => {
      const all = readAllSync(workspaceDir);
      const rec = all.find((r) => r.id === id);
      if (!rec) {
        return { error: "not_found" as const };
      }
      if (rec.state !== "pending") {
        return { error: "not_pending" as const };
      }
      return { rec };
    });
    if (!check.rec) {
      return { ok: false, error: check.error };
    }
    const rec = check.rec;
    // 2) writer（markdown 落盘，不涉 jsonl）
    await writer(rec);
    const next: MemoryAdoptionRecord = {
      ...rec,
      state: "adopted",
      resolvedAt: new Date().toISOString(),
      note: opts?.note ?? rec.note,
    };
    // 3) 锁内二次读 + 条件写入：仍是 pending 才翻转（并发翻转者胜出，本请求报 not_pending）
    const written = withSuggestionsFileLock(workspaceDir, () => {
      const all = readAllSync(workspaceDir);
      const idx = all.findIndex((r) => r.id === id);
      if (idx < 0 || all[idx].state !== "pending") {
        return false;
      }
      all[idx] = next;
      rewriteAllLocked(workspaceDir, all);
      return true;
    });
    if (!written) {
      return { ok: false, error: "not_pending" };
    }
    await emit(auditDir, {
      taskId: rec.sourceTaskId ?? "system",
      kind: "memory.adoption_adopted",
      actor: "lawyer",
      actorId: opts?.actorId,
      detail: JSON.stringify({ suggestionId: id, scope: rec.scope, kind: rec.kind }),
    });
    return { ok: true, record: next };
  });
}

export async function dismissMemorySuggestion(
  workspaceDir: string,
  auditDir: string,
  id: string,
  opts?: { actorId?: string; note?: string },
): Promise<{ ok: boolean; error?: string; record?: MemoryAdoptionRecord }> {
  return withAdoptionMutationLock(async () => {
    const written = withSuggestionsFileLock(workspaceDir, () => {
      const all = readAllSync(workspaceDir);
      const idx = all.findIndex((r) => r.id === id);
      if (idx < 0) {
        return { error: "not_found" as const };
      }
      const rec = all[idx];
      if (rec.state !== "pending") {
        return { error: "not_pending" as const };
      }
      const next: MemoryAdoptionRecord = {
        ...rec,
        state: "dismissed",
        resolvedAt: new Date().toISOString(),
        note: opts?.note ?? rec.note,
      };
      all[idx] = next;
      rewriteAllLocked(workspaceDir, all);
      return { next };
    });
    if (!written.next) {
      return { ok: false, error: written.error };
    }
    await emit(auditDir, {
      taskId: written.next.sourceTaskId ?? "system",
      kind: "memory.adoption_dismissed",
      actor: "lawyer",
      actorId: opts?.actorId,
      detail: JSON.stringify({ suggestionId: id, scope: written.next.scope }),
    });
    return { ok: true, record: written.next };
  });
}

/**
 * Mark pending review_label (or any) adoption rows that share `sourceTaskId`
 * as adopted — used when the learning suggestion queue adopts first and the
 * mirrored MemoryAdoptionService row should stay in sync.
 * Does not run a writer (payload already applied by the caller).
 */
export async function markAdoptedBySourceTaskId(
  workspaceDir: string,
  auditDir: string,
  sourceTaskId: string,
  opts?: { kind?: MemoryAdoptionKind },
): Promise<{ updated: number }> {
  return withAdoptionMutationLock(async () => {
    const updated = withSuggestionsFileLock(workspaceDir, () => {
      const all = readAllSync(workspaceDir);
      const now = new Date().toISOString();
      let n = 0;
      for (let i = 0; i < all.length; i++) {
        const rec = all[i];
        if (rec.state !== "pending") {
          continue;
        }
        if (rec.sourceTaskId !== sourceTaskId) {
          continue;
        }
        if (opts?.kind && rec.kind !== opts.kind) {
          continue;
        }
        all[i] = {
          ...rec,
          state: "adopted",
          resolvedAt: now,
        };
        n += 1;
      }
      if (n > 0) {
        rewriteAllLocked(workspaceDir, all);
      }
      return n;
    });
    if (updated > 0) {
      await emit(auditDir, {
        taskId: sourceTaskId,
        kind: "memory.adoption_adopted",
        actor: "lawyer",
        detail: JSON.stringify({
          bySourceTaskId: true,
          updated,
          kind: opts?.kind ?? null,
        }),
      });
    }
    return { updated };
  });
}

/**
 * Mark pending adoption rows that share `sourceTaskId` as dismissed —
 * keeps learning-queue dismiss in sync with MemoryAdoptionService.
 */
export async function markDismissedBySourceTaskId(
  workspaceDir: string,
  auditDir: string,
  sourceTaskId: string,
  opts?: { kind?: MemoryAdoptionKind },
): Promise<{ updated: number }> {
  return withAdoptionMutationLock(async () => {
    const updated = withSuggestionsFileLock(workspaceDir, () => {
      const all = readAllSync(workspaceDir);
      const now = new Date().toISOString();
      let n = 0;
      for (let i = 0; i < all.length; i++) {
        const rec = all[i];
        if (rec.state !== "pending") {
          continue;
        }
        if (rec.sourceTaskId !== sourceTaskId) {
          continue;
        }
        if (opts?.kind && rec.kind !== opts.kind) {
          continue;
        }
        all[i] = {
          ...rec,
          state: "dismissed",
          resolvedAt: now,
        };
        n += 1;
      }
      if (n > 0) {
        rewriteAllLocked(workspaceDir, all);
      }
      return n;
    });
    if (updated > 0) {
      await emit(auditDir, {
        taskId: sourceTaskId,
        kind: "memory.adoption_dismissed",
        actor: "lawyer",
        detail: JSON.stringify({
          bySourceTaskId: true,
          updated,
          kind: opts?.kind ?? null,
        }),
      });
    }
    return { updated };
  });
}

export async function listMemorySuggestions(
  workspaceDir: string,
  opts?: { scope?: MemoryScope; state?: MemoryAdoptionState; targetId?: string },
): Promise<MemoryAdoptionRecord[]> {
  const all = await readAll(workspaceDir);
  return all
    .filter((r) => (opts?.scope ? r.scope === opts.scope : true))
    .filter((r) => (opts?.state ? r.state === opts.state : true))
    .filter((r) => (opts?.targetId ? r.targetId === opts.targetId : true))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listPendingMemorySuggestions(
  workspaceDir: string,
  opts?: { scope?: MemoryScope; targetId?: string },
): Promise<MemoryAdoptionRecord[]> {
  return listMemorySuggestions(workspaceDir, { ...opts, state: "pending" });
}
