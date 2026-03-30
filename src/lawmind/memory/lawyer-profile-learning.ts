/**
 * 律师偏好「显式学习」——仅通过审核台勾选或 API 写入，避免静默污染 LAWYER_PROFILE.md。
 */

import fs from "node:fs/promises";
import path from "node:path";

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
 */
export async function appendLawyerProfileLearning(
  workspaceDir: string,
  bulletText: string,
  source: "review" | "manual",
): Promise<void> {
  await ensureLawyerProfileSkeleton(workspaceDir);
  const p = path.join(workspaceDir, PROFILE);
  let content = await readUtf8(p);
  if (!content.trim()) {
    await ensureLawyerProfileSkeleton(workspaceDir);
    content = await readUtf8(p);
  }
  const line = `- [${stamp()}] [source:${source}] ${bulletText.trim()}`;
  if (!content.includes(SECTION_EIGHT)) {
    content = `${content.trimEnd()}\n\n${SECTION_EIGHT}\n\n${line}\n`;
    await fs.writeFile(p, content, "utf8");
    return;
  }
  const eightIdx = content.indexOf(SECTION_EIGHT);
  const tailIdx = content.lastIndexOf(TAIL_MARKER);
  if (tailIdx > eightIdx) {
    const before = content.slice(0, tailIdx).trimEnd();
    const after = content.slice(tailIdx);
    content = `${before}\n${line}\n${after}`;
    await fs.writeFile(p, content, "utf8");
    return;
  }
  content = `${content.trimEnd()}\n${line}\n`;
  await fs.writeFile(p, content, "utf8");
}
