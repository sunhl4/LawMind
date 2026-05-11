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
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
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
  "review_label",
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

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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

async function writeAll(workspaceDir: string, records: MemoryAdoptionRecord[]): Promise<void> {
  const file = suggestionsFile(workspaceDir);
  await ensureDir(file);
  const body = records.map((r) => JSON.stringify(r)).join("\n");
  await fs.writeFile(file, body ? `${body}\n` : "", "utf8");
}

/**
 * 同步追加一条 suggestion，避免 fire-and-forget 与测试 rmSync 竞速。
 * （JSONL 单行 append 在小并发下仍然安全。）
 */
function appendOneSync(workspaceDir: string, rec: MemoryAdoptionRecord): void {
  recordSchema.parse(rec);
  const file = suggestionsFile(workspaceDir);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(rec)}\n`, "utf8");
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
  const all = await readAll(workspaceDir);
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) {
    return { ok: false, error: "not_found" };
  }
  const rec = all[idx];
  if (rec.state !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  await writer(rec);
  const next: MemoryAdoptionRecord = {
    ...rec,
    state: "adopted",
    resolvedAt: new Date().toISOString(),
    note: opts?.note ?? rec.note,
  };
  all[idx] = next;
  await writeAll(workspaceDir, all);
  await emit(auditDir, {
    taskId: rec.sourceTaskId ?? "system",
    kind: "memory.adoption_adopted",
    actor: "lawyer",
    actorId: opts?.actorId,
    detail: JSON.stringify({ suggestionId: id, scope: rec.scope, kind: rec.kind }),
  });
  return { ok: true, record: next };
}

export async function dismissMemorySuggestion(
  workspaceDir: string,
  auditDir: string,
  id: string,
  opts?: { actorId?: string; note?: string },
): Promise<{ ok: boolean; error?: string; record?: MemoryAdoptionRecord }> {
  const all = await readAll(workspaceDir);
  const idx = all.findIndex((r) => r.id === id);
  if (idx < 0) {
    return { ok: false, error: "not_found" };
  }
  const rec = all[idx];
  if (rec.state !== "pending") {
    return { ok: false, error: "not_pending" };
  }
  const next: MemoryAdoptionRecord = {
    ...rec,
    state: "dismissed",
    resolvedAt: new Date().toISOString(),
    note: opts?.note ?? rec.note,
  };
  all[idx] = next;
  await writeAll(workspaceDir, all);
  await emit(auditDir, {
    taskId: rec.sourceTaskId ?? "system",
    kind: "memory.adoption_dismissed",
    actor: "lawyer",
    actorId: opts?.actorId,
    detail: JSON.stringify({ suggestionId: id, scope: rec.scope }),
  });
  return { ok: true, record: next };
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
