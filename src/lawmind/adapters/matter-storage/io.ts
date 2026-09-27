/**
 * 文件 IO helpers — JSON 读写 + JSONL 追加 + 原子替换 + zod 校验。
 *
 * 真相源布局（W3 引入；与现有 Markdown 并存，由 service 负责双轨）：
 *   workspace/matters/<matterId>/matter.json
 *   workspace/matters/<matterId>/deliverables/<deliverableId>.json
 *   workspace/matters/<matterId>/approvals.jsonl
 *   workspace/matters/<matterId>/queue.jsonl
 *   workspace/matters/<matterId>/deadlines.jsonl
 */

import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";

export function mattersRoot(workspaceDir: string): string {
  return path.join(workspaceDir, "matters");
}

export function matterDir(workspaceDir: string, matterId: string): string {
  return path.join(mattersRoot(workspaceDir), matterId);
}

export function ensureMatterDir(workspaceDir: string, matterId: string): string {
  const dir = matterDir(workspaceDir, matterId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function deliverablesDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "deliverables");
}

export function ensureDeliverablesDir(workspaceDir: string, matterId: string): string {
  const dir = deliverablesDir(workspaceDir, matterId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 安全的原子写：先写 .tmp 再 rename，避免半写。 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/** 异步原子写：先写 .tmp 再 rename，避免半写撕档（用于 async 写侧服务）。 */
export async function writeFileAtomicAsync(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await fs.promises.writeFile(tmp, content, "utf8");
  await fs.promises.rename(tmp, filePath);
}

/** 读 JSON 并按 schema 校验；失败抛 ZodError。 */
export function readJsonValidated<T>(filePath: string, schema: z.ZodType<T>): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

/** 追加一行 JSONL；用 schema 校验，并保证目录存在。 */
export function appendJsonl<T>(filePath: string, schema: z.ZodType<T>, value: T): void {
  schema.parse(value);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

/** 全量重写 JSONL（用于 update / dismiss 这种需要替换某一行的情形）。temp + rename，避免半写撕档。 */
export function rewriteJsonl<T>(filePath: string, schema: z.ZodType<T>, values: T[]): void {
  for (const v of values) {
    schema.parse(v);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = values.map((v) => JSON.stringify(v)).join("\n");
  const content = body ? `${body}\n` : "";
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

/** 锁文件内容：持锁进程 pid + 获取时间，用于 stale 自愈。 */
type FileLockMeta = { pid: number; acquiredAt: number };

function isLockOwnerAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 进程存在但无权 signal —— 视为存活，不抢锁。
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readFileLockMeta(lockPath: string): { meta?: FileLockMeta; mtimeMs: number } | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(lockPath);
  } catch {
    return undefined; // 已被释放
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<FileLockMeta>;
    if (typeof parsed.pid === "number" && typeof parsed.acquiredAt === "number") {
      return { meta: { pid: parsed.pid, acquiredAt: parsed.acquiredAt }, mtimeMs: stat.mtimeMs };
    }
  } catch {
    /* legacy 空锁 / 半写：退回 mtime 锁龄判断 */
  }
  return { mtimeMs: stat.mtimeMs };
}

/** stale 判定：持锁 pid 已死，或锁龄超过阈值（legacy 空锁只看锁龄）。 */
function isStaleFileLock(lockPath: string, staleMs: number, now: number): boolean {
  const info = readFileLockMeta(lockPath);
  if (!info) {
    return false;
  }
  if (info.meta) {
    if (!isLockOwnerAlive(info.meta.pid)) {
      return true;
    }
    return now - info.meta.acquiredAt > staleMs;
  }
  return now - info.mtimeMs > staleMs;
}

/**
 * 原子接管 stale 锁：rename 只有一个进程能成功，失败者返回 false 继续轮询；
 * 随后仍走 O_EXCL 重建，保证接管不破坏互斥。
 */
function takeoverStaleFileLock(lockPath: string): boolean {
  const trash = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockPath, trash);
  } catch {
    return false;
  }
  try {
    fs.unlinkSync(trash);
  } catch {
    /* ignore */
  }
  console.warn(`[LawMind] 自愈接管 stale 文件锁：${lockPath}`);
  return true;
}

/**
 * Exclusive create lock (`O_EXCL`) with busy-wait poll.
 * Used for JSONL rewrite races (e.g. approval resolve).
 *
 * stale 自愈：持锁进程崩溃后锁文件残留会让该任务永久 file_lock_timeout。
 * 获取失败时检查锁文件里的 pid / 锁龄——pid 已死或锁龄超 `staleMs`（默认 60s）
 * 即判定 stale，原子接管后重试。
 */
export function withExclusiveFileLock<T>(
  lockPath: string,
  fn: () => T,
  opts?: { timeoutMs?: number; pollMs?: number; staleMs?: number },
): T {
  const timeoutMs = opts?.timeoutMs ?? 5_000;
  const pollMs = Math.max(1, opts?.pollMs ?? 5);
  const staleMs = Math.max(1_000, opts?.staleMs ?? 60_000);
  const started = Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(
          fd,
          JSON.stringify({ pid: process.pid, acquiredAt: Date.now() } satisfies FileLockMeta),
        );
        return fn();
      } finally {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw e;
      }
      // stale 优先于超时：能自愈就不让用户等死。
      if (isStaleFileLock(lockPath, staleMs, Date.now()) && takeoverStaleFileLock(lockPath)) {
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`file_lock_timeout:${path.basename(lockPath)}`, { cause: e });
      }
      const end = Date.now() + pollMs;
      while (Date.now() < end) {
        /* spin */
      }
    }
  }
}

/** 读取 JSONL，返回有效 schema 的行；坏行被跳过（best-effort）。 */
export function readJsonl<T>(filePath: string, schema: z.ZodType<T>): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const safe = schema.safeParse(parsed);
      if (safe.success) {
        out.push(safe.data);
      }
    } catch {
      // skip bad line
    }
  }
  return out;
}

/** 列出 matters/ 下的全部 matterId（按目录名）。 */
export function listMatterIdsFromStorage(workspaceDir: string): string[] {
  const root = mattersRoot(workspaceDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
