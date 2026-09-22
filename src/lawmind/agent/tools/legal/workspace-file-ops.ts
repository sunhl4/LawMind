/**
 * 工作区文件操作的共用执行层：**求解**（逐条校验）→ **执行**（搬移/复制）→ **记账**（可撤销）。
 *
 * 为什么抽出来：LawMind 里"能移动文件"的入口不止一个（案件材料归位、一般文件操作），
 * 但它们必须是**同一套执行语义**——否则撤销行为会分叉，律师看到的"放回去"时好时坏。
 * 各自的**围栏**留在各自的工具里（归位只认 cases/uploads；一般操作认整个工作区），
 * 这里只负责"围栏已判定通过之后"的公共动作：
 *
 *   - 拒绝：源不存在、目标已存在、目标在源目录之内、符号链接、体积超限
 *   - 执行：父目录按需创建；`copy` 走 cpSync（不 dereference 软链）
 *   - 记账：写 desk-write 日志（kind=file_ops），`revert_desk_write` 按工作区根反向回放
 */

import fs from "node:fs";
import path from "node:path";
import {
  appendDeskWrite,
  newDeskWriteId,
  type WorkspaceFileOp,
} from "../../../desk/desk-write-journal.js";

export const FILE_OPS_MAX_OPS = 50;
export const FILE_OPS_MAX_COPY_FILES = 200;
export const FILE_OPS_MAX_COPY_TOTAL_BYTES = 200 * 1024 * 1024;

/** 围栏判定通过后的路径。`matterId` 为 null 表示不在任何案件卷内（如 uploads/）。 */
export type ScopedPathRef = {
  abs: string;
  rel: string;
  matterId: string | null;
  label: string;
};

export type ClassifyResult = { ok: true; scoped: ScopedPathRef } | { ok: false; error: string };

/** 每个工具自带围栏：只做"这句路径能不能碰"的判定，不做执行。 */
export type ClassifyFn = (workspaceDir: string, raw: string) => ClassifyResult;

/**
 * 案件卷内的真相源文件：卷宗、期限、谈话、写入日志、整理计划。
 *
 * `isProtectedWorkspaceRel` 保护的是 `matters/` 前缀与 `RULES.md` 等，**不覆盖**
 * `cases/<案>/CASE.md` 这类结构文件。允许搬它们等于允许「用移动文件冒充改案」，
 * 所以两个文件操作入口都必须拒——规则放这里，避免各自漏抄。
 */
const CASE_STRUCTURAL_ENTRIES = new Set([
  "CASE.md",
  "matter.json",
  ".lawmind-role.txt",
  "deadlines.jsonl",
  "intake-brief.json",
  "desk-writes.jsonl",
  "organize-plan.pending.json",
  "RULES.md",
  "ethics-wall.json",
  ".lawmind-dms.json",
]);

/** 该工作区相对路径是否命中案件卷内的真相源文件（`cases/<案>/<结构文件>`）。 */
export function isCaseStructuralRel(rel: string): boolean {
  const segments = rel.replace(/\\/g, "/").split("/");
  if (segments[0] !== "cases" || segments.length < 3) {
    return false;
  }
  const inner = segments[2] ?? "";
  return Boolean(inner) && (inner.startsWith(".") || CASE_STRUCTURAL_ENTRIES.has(inner));
}

export type SolvedFileOp = {
  from: ScopedPathRef;
  to: ScopedPathRef;
  copy: boolean;
  reason?: string;
};

export function isSameOrInside(parentAbs: string, childAbs: string): boolean {
  const rel = path.relative(parentAbs, childAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 目录树的文件数与字节数（软链跳过）。`overflow` 为真表示超过复制上限。 */
export function measureTree(abs: string): { files: number; bytes: number; overflow: boolean } {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { files: 0, bytes: 0, overflow: false };
  }
  if (st.isFile()) {
    return { files: 1, bytes: st.size, overflow: false };
  }
  if (!st.isDirectory()) {
    return { files: 0, bytes: 0, overflow: false };
  }
  let files = 0;
  let bytes = 0;
  let overflow = false;
  const visit = (dir: string): void => {
    if (overflow) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (overflow) {
        return;
      }
      if (ent.isSymbolicLink()) {
        continue;
      }
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        visit(child);
        continue;
      }
      if (!ent.isFile()) {
        continue;
      }
      files += 1;
      try {
        bytes += fs.statSync(child).size;
      } catch {
        /* skip unreadable */
      }
      if (files > FILE_OPS_MAX_COPY_FILES || bytes > FILE_OPS_MAX_COPY_TOTAL_BYTES) {
        overflow = true;
      }
    }
  };
  visit(abs);
  return { files, bytes, overflow };
}

/** 逐条校验：能办的分到 solved，办不了的连同原因分到 skipped（不静默丢弃）。 */
export function solveFileOps(opts: {
  workspaceDir: string;
  rawOps: unknown[];
  classify: ClassifyFn;
}): { solved: SolvedFileOp[]; skipped: string[] } {
  const solved: SolvedFileOp[] = [];
  const skipped: string[] = [];
  const seenTargets = new Set<string>();
  for (const raw of opts.rawOps) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const fromRaw = typeof row.from === "string" ? row.from : "";
    const toRaw = typeof row.to === "string" ? row.to : "";
    const opRaw = typeof row.op === "string" ? row.op.trim().toLowerCase() : "";
    // `copy: true` 与 `op: "copy"` 等价写法，模型两种都可能发。
    const copy = row.copy === true || opRaw === "copy";
    const reason =
      typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : undefined;
    const source = opts.classify(opts.workspaceDir, fromRaw);
    const target = opts.classify(opts.workspaceDir, toRaw);
    if (!source.ok) {
      skipped.push(`${fromRaw || "（空）"}：${source.error}`);
      continue;
    }
    if (!target.ok) {
      skipped.push(`${toRaw || "（空）"}：${target.error}`);
      continue;
    }
    if (source.scoped.rel === target.scoped.rel) {
      skipped.push(`${fromRaw}：源与目标相同`);
      continue;
    }
    if (!fs.existsSync(source.scoped.abs)) {
      skipped.push(`${source.scoped.rel}：源文件不存在`);
      continue;
    }
    if (fs.existsSync(target.scoped.abs)) {
      skipped.push(`${target.scoped.rel}：目标已存在（请先改名或先处理同名文件）`);
      continue;
    }
    if (seenTargets.has(target.scoped.rel)) {
      skipped.push(`${target.scoped.rel}：本次计划内重复`);
      continue;
    }
    if (isSameOrInside(source.scoped.abs, target.scoped.abs)) {
      skipped.push(`${target.scoped.rel}：目标在源目录之内`);
      continue;
    }
    let st: fs.Stats;
    try {
      st = fs.lstatSync(source.scoped.abs);
    } catch {
      skipped.push(`${source.scoped.rel}：读不到源`);
      continue;
    }
    if (st.isSymbolicLink()) {
      skipped.push(`${source.scoped.rel}：符号链接不搬移`);
      continue;
    }
    if (copy && st.isDirectory() && measureTree(source.scoped.abs).overflow) {
      skipped.push(
        `${source.scoped.rel}：文件夹过大（超过 ${FILE_OPS_MAX_COPY_FILES} 个文件或 200MB）`,
      );
      continue;
    }
    seenTargets.add(target.scoped.rel);
    solved.push({ from: source.scoped, to: target.scoped, copy, ...(reason ? { reason } : {}) });
  }
  return { solved, skipped };
}

/** 目标案件必须已存在：不许用搬移顺手造出幽灵案件目录。 */
export function missingTargetMatters(workspaceDir: string, solved: SolvedFileOp[]): string[] {
  const missing = new Set<string>();
  for (const item of solved) {
    const dst = item.to.matterId;
    if (dst && !fs.existsSync(path.join(workspaceDir, "cases", dst))) {
      missing.add(dst);
    }
  }
  return [...missing];
}

/** 执行并记账。返回逐条结果，供律师卡与模型正文使用。 */
export function applySolvedFileOps(opts: {
  workspaceDir: string;
  matterId: string;
  solved: SolvedFileOp[];
}): { applied: WorkspaceFileOp[]; failed: string[]; writeId?: string } {
  const applied: WorkspaceFileOp[] = [];
  const failed: string[] = [];
  for (const item of opts.solved) {
    try {
      const st = fs.lstatSync(item.from.abs);
      fs.mkdirSync(path.dirname(item.to.abs), { recursive: true });
      let bytes: number | undefined;
      if (item.copy) {
        bytes = st.isDirectory() ? measureTree(item.from.abs).bytes : st.size;
        fs.cpSync(item.from.abs, item.to.abs, { recursive: true, dereference: false });
      } else {
        fs.renameSync(item.from.abs, item.to.abs);
      }
      applied.push({
        from: item.from.rel,
        to: item.to.rel,
        ...(item.copy ? { copied: true } : {}),
        ...(typeof bytes === "number" ? { bytes } : {}),
        ...(item.reason ? { reason: item.reason } : {}),
      });
    } catch (e) {
      failed.push(`${item.from.rel}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (applied.length === 0) {
    return { applied, failed };
  }
  const writeId = newDeskWriteId();
  appendDeskWrite(opts.workspaceDir, {
    writeId,
    matterId: opts.matterId,
    kind: "file_ops",
    createdAt: new Date().toISOString(),
    fileOps: applied,
  });
  return { applied, failed, writeId };
}

/** 把 applied 转成给律师看的一行行「甲 → 乙（复制）」。 */
export function formatAppliedLines(applied: WorkspaceFileOp[]): string[] {
  return applied.map((op) => `${op.from} → ${op.to}${op.copied ? "（复制）" : ""}`);
}

/** 跨案操作涉及了哪些"别的案"。 */
export function crossedMatterIds(applied: WorkspaceFileOp[], matterId: string): string[] {
  const crossed = new Set<string>();
  for (const op of applied) {
    for (const rel of [op.from, op.to]) {
      if (!rel.startsWith("cases/")) {
        continue;
      }
      const mid = rel.split("/")[1];
      if (mid && mid !== matterId) {
        crossed.add(mid);
      }
    }
  }
  return [...crossed];
}
