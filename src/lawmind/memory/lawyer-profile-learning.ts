/**
 * 律师偏好「显式学习」——仅通过审核台勾选或 API 写入，避免静默污染 LAWYER_PROFILE.md。
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { emit } from "../audit/index.js";

async function readUtf8(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

const PROFILE = "LAWYER_PROFILE.md";
const SECTION_EIGHT = "## 八、个人积累";
const TAIL_MARKER = "\n---\n\n_最后更新";

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

/** 从审核学习行中解析任务 ID（与 buildLawyerProfileReviewLearningLine 格式一致）。 */
export function taskIdFromLawyerProfileReviewBullet(bulletText: string): string | undefined {
  const m = /任务\s+([a-zA-Z0-9._-]+)/.exec(bulletText);
  return m?.[1];
}

function lawyerSectionEightSlice(content: string): string {
  const eightIdx = content.indexOf(SECTION_EIGHT);
  if (eightIdx < 0) {
    return "";
  }
  const tailIdx = content.indexOf(TAIL_MARKER, eightIdx);
  return tailIdx > eightIdx ? content.slice(eightIdx, tailIdx) : content.slice(eightIdx);
}

function sectionEightHasLawyerReviewForTask(content: string, taskId: string): boolean {
  const slice = lawyerSectionEightSlice(content);
  return slice.includes(`任务 ${taskId}`) && slice.includes("草稿审核学习");
}

function sectionEightHasManualCore(content: string, core: string): boolean {
  const slice = lawyerSectionEightSlice(content);
  return core.length > 0 && slice.includes(core);
}

export type AppendLawyerProfileLearningOptions = {
  auditDir?: string;
  auditTaskId?: string;
};

/** 审核结论写入「个人积累」的单行摘要（可测）。 */
export function buildLawyerProfileReviewLearningLine(
  taskId: string,
  status: string,
  note?: string,
): string {
  const n = note?.trim();
  return n
    ? `草稿审核学习（任务 ${taskId}，${status}）：${n}`
    : `草稿审核学习（任务 ${taskId}，${status}）。`;
}

/**
 * 若无法律师档案文件，写入与仓库 `workspace/LAWYER_PROFILE.md` 同构的精简骨架（含第八节）。
 */
export async function ensureLawyerProfileSkeleton(workspaceDir: string): Promise<void> {
  const p = path.join(workspaceDir, PROFILE);
  const exists = await fs
    .access(p)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return;
  }
  const skeleton = [
    "# LAWYER_PROFILE.md — 律师个人偏好记忆",
    "",
    "本文件记录律师个性化习惯。任务启动时与 `MEMORY.md` 一同加载。",
    "",
    "---",
    "",
    SECTION_EIGHT,
    "",
    "_此节记录经显式确认的偏好学习条目（审核台或 API）。_",
    "",
    "---",
    "",
    "_最后更新：（由系统更新）_",
    "",
  ].join("\n");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(p, skeleton, "utf8");
}

/**
 * 在「八、个人积累」追加一条 bullet，带来源标记（review | manual）。
 * 优先插在 `_最后更新` 之前的 `---` 之前，与仓库模板结构一致。
 * 同一 taskId 的 review 学习行只保留一条；manual 在同一节重复核心文案时跳过。
 */
export async function appendLawyerProfileLearning(
  workspaceDir: string,
  bulletText: string,
  source: "review" | "manual",
  opts?: AppendLawyerProfileLearningOptions,
): Promise<{ skipped: boolean }> {
  await ensureLawyerProfileSkeleton(workspaceDir);
  const p = path.join(workspaceDir, PROFILE);
  let content = await readUtf8(p);
  if (!content.trim()) {
    await ensureLawyerProfileSkeleton(workspaceDir);
    content = await readUtf8(p);
  }

  const core = bulletText.trim();
  if (!core) {
    return { skipped: true };
  }

  if (source === "review") {
    const tid = taskIdFromLawyerProfileReviewBullet(core);
    if (tid && sectionEightHasLawyerReviewForTask(content, tid)) {
      return { skipped: true };
    }
  } else if (sectionEightHasManualCore(content, core)) {
    return { skipped: true };
  }

  const line = `- [${stamp()}] [source:${source}] ${core}`;
  if (!content.includes(SECTION_EIGHT)) {
    content = `${content.trimEnd()}\n\n${SECTION_EIGHT}\n\n${line}\n`;
    await fs.writeFile(p, content, "utf8");
    await maybeEmitLawyerProfileAudit(opts, line, source, core);
    return { skipped: false };
  }
  const eightIdx = content.indexOf(SECTION_EIGHT);
  const tailIdx = content.lastIndexOf(TAIL_MARKER);
  if (tailIdx > eightIdx) {
    const before = content.slice(0, tailIdx).trimEnd();
    const after = content.slice(tailIdx);
    content = `${before}\n${line}\n${after}`;
    await fs.writeFile(p, content, "utf8");
    await maybeEmitLawyerProfileAudit(opts, line, source, core);
    return { skipped: false };
  }
  content = `${content.trimEnd()}\n${line}\n`;
  await fs.writeFile(p, content, "utf8");
  await maybeEmitLawyerProfileAudit(opts, line, source, core);
  return { skipped: false };
}

async function maybeEmitLawyerProfileAudit(
  opts: AppendLawyerProfileLearningOptions | undefined,
  line: string,
  source: "review" | "manual",
  core: string,
): Promise<void> {
  if (!opts?.auditDir) {
    return;
  }
  const hash = createHash("sha256").update(line).digest("hex").slice(0, 16);
  const taskId =
    opts.auditTaskId?.trim() ||
    taskIdFromLawyerProfileReviewBullet(core) ||
    "lawyer-profile-learning";
  await emit(opts.auditDir, {
    taskId,
    kind: "memory.profile_updated",
    actor: "lawyer",
    detail: `LAWYER_PROFILE 八、个人积累 source=${source} hash=${hash}`,
  });
}
