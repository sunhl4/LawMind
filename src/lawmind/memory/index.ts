/**
 * Memory Layer
 *
 * 负责在任务启动时加载双记忆文档，并提供写入接口。
 *
 * 读取顺序（固定）：
 *   1. MEMORY.md        — 通用长期记忆
 *   2. LAWYER_PROFILE.md — 律师个人偏好
 *   3. memory/YYYY-MM-DD.md（今天）— 日志
 *   4. memory/YYYY-MM-DD.md（昨天）— 日志
 *
 * 第二阶段：增加 cases/<matterId>/CASE.md 的按需读取。
 */

import fs from "node:fs/promises";
import path from "node:path";

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export type MemoryContext = {
  /** MEMORY.md 内容 */
  general: string;
  /** LAWYER_PROFILE.md 内容 */
  profile: string;
  /** 案件级记忆（若指定 matterId） */
  caseMemory: string;
  /** 今天的日志 */
  todayLog: string;
  /** 昨天的日志 */
  yesterdayLog: string;
};

// ─────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────

async function readSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    // 文件不存在时静默返回空串，上游可以判断
    return "";
  }
}

function dailyLogPath(workspaceDir: string, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return path.join(workspaceDir, "memory", `${yyyy}-${mm}-${dd}.md`);
}

export function caseFilePath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "CASE.md");
}

function defaultCaseTemplate(matterId: string): string {
  return `# 案件档案：${matterId}

## 1. 基本信息

- matterId: ${matterId}
- 案由:
- 当前阶段:
- 负责人:

## 2. 当事人

- 甲方:
- 乙方:
- 其他相关方:

## 3. 事实摘要

- 

## 4. 核心争点

- 

## 5. 证据与材料清单

- 

## 6. 当前任务目标

- 

## 7. 风险与待确认事项

- 

## 8. 工作进展记录

- 

## 9. 生成产物

- 
`;
}

function timestampLabel(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

type SectionWriteMode = "append" | "merge";

function normalizeEntry(value: string): string {
  return value
    .replace(/^-\s*\[[^\]]+\]\s*/, "")
    .replace(/^-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSectionEntries(sectionBody: string): string[] {
  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"))
    .map(normalizeEntry)
    .filter(Boolean);
}

function writeMarkdownBulletToSection(
  content: string,
  heading: string,
  bullet: string,
  opts: { mode: SectionWriteMode; timestamped: boolean },
): string {
  const entry = opts.timestamped ? `- [${timestampLabel()}] ${bullet}` : `- ${bullet}`;
  const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
  const match = headingPattern.exec(content);

  if (!match || match.index < 0) {
    return `${content.trimEnd()}\n\n${heading}\n\n${entry}\n`;
  }

  const insertStart = match.index + match[0].length;
  const afterHeading = content.slice(insertStart);
  const nextHeadingIndex = afterHeading.search(/\n##\s+\d+\./);
  const sectionEnd = nextHeadingIndex >= 0 ? insertStart + nextHeadingIndex + 1 : content.length;
  const sectionBody = content.slice(insertStart, sectionEnd);
  const trimmedBody = sectionBody.replace(/\s+$/g, "");
  const normalizedBullet = normalizeEntry(bullet);

  if (opts.mode === "merge") {
    const existingEntries = new Set(extractSectionEntries(sectionBody));
    if (existingEntries.has(normalizedBullet)) {
      return content;
    }
  }

  if (trimmedBody === "" || trimmedBody === "\n-" || trimmedBody === "\n- ") {
    return `${content.slice(0, insertStart)}\n\n${entry}\n${content.slice(sectionEnd)}`;
  }

  return `${content.slice(0, sectionEnd).trimEnd()}\n${entry}\n${content.slice(sectionEnd)}`;
}

// ─────────────────────────────────────────────
// 加载双记忆
// ─────────────────────────────────────────────

/**
 * 加载任务所需的记忆上下文。
 * 每次任务启动时调用一次，结果传入 Retrieval 和 Reasoning 层。
 */
export async function loadMemoryContext(
  workspaceDir: string,
  opts: { matterId?: string } = {},
): Promise<MemoryContext> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const caseMemoryPromise = opts.matterId
    ? readSafe(caseFilePath(workspaceDir, opts.matterId))
    : "";

  const [general, profile, caseMemory, todayLog, yesterdayLog] = await Promise.all([
    readSafe(path.join(workspaceDir, "MEMORY.md")),
    readSafe(path.join(workspaceDir, "LAWYER_PROFILE.md")),
    caseMemoryPromise,
    readSafe(dailyLogPath(workspaceDir, today)),
    readSafe(dailyLogPath(workspaceDir, yesterday)),
  ]);

  return { general, profile, caseMemory, todayLog, yesterdayLog };
}

/**
 * 为指定案件初始化工作目录与 CASE.md。
 * 仅在缺失时创建，已有内容不覆盖。
 */
export async function ensureCaseWorkspace(workspaceDir: string, matterId: string): Promise<string> {
  const filePath = caseFilePath(workspaceDir, matterId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await fs.writeFile(filePath, defaultCaseTemplate(matterId), "utf8");
  }

  return filePath;
}

/**
 * 向 CASE.md 的指定章节追加 bullet 记录。
 * 若章节不存在则自动补建，便于逐步演进案件工作台。
 */
export async function appendCaseSectionBullet(
  workspaceDir: string,
  matterId: string,
  heading: string,
  bullet: string,
  opts: { mode?: SectionWriteMode; timestamped?: boolean } = {},
): Promise<void> {
  const filePath = await ensureCaseWorkspace(workspaceDir, matterId);
  const current = await readSafe(filePath);
  const next = writeMarkdownBulletToSection(current, heading, bullet, {
    mode: opts.mode ?? "append",
    timestamped: opts.timestamped ?? true,
  });
  await fs.writeFile(filePath, next, "utf8");
}

export async function appendCaseTaskGoal(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  await appendCaseSectionBullet(workspaceDir, matterId, "## 6. 当前任务目标", bullet, {
    mode: "merge",
    timestamped: false,
  });
}

export async function appendCaseCoreIssue(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  await appendCaseSectionBullet(workspaceDir, matterId, "## 4. 核心争点", bullet, {
    mode: "merge",
    timestamped: false,
  });
}

export async function appendCaseRiskNote(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  await appendCaseSectionBullet(workspaceDir, matterId, "## 7. 风险与待确认事项", bullet, {
    mode: "merge",
    timestamped: false,
  });
}

export async function appendCaseProgress(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  await appendCaseSectionBullet(workspaceDir, matterId, "## 8. 工作进展记录", bullet);
}

export async function appendCaseArtifact(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  await appendCaseSectionBullet(workspaceDir, matterId, "## 9. 生成产物", bullet, {
    mode: "merge",
    timestamped: false,
  });
}

// ─────────────────────────────────────────────
// 写入日志（追加到今天的日志文件）
// ─────────────────────────────────────────────

/**
 * 向今天的日志文件追加一条记录。
 * 用于记录任务进展、决策、审核结果等。
 */
export async function appendTodayLog(workspaceDir: string, entry: string): Promise<void> {
  const logPath = dailyLogPath(workspaceDir, new Date());
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const timestamp = new Date().toISOString();
  const line = `\n<!-- ${timestamp} -->\n${entry}\n`;
  await fs.appendFile(logPath, line, "utf8");
}

// ─────────────────────────────────────────────
// 更新律师偏好（追加到 LAWYER_PROFILE.md 第八节）
// ─────────────────────────────────────────────

/**
 * 将新偏好追加到 LAWYER_PROFILE.md 的"个人积累"节。
 * 只追加，不改写现有内容。
 */
export async function appendLawyerProfile(workspaceDir: string, note: string): Promise<void> {
  const profilePath = path.join(workspaceDir, "LAWYER_PROFILE.md");
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `\n- [${timestamp}] ${note}`;
  await fs.appendFile(profilePath, entry, "utf8");
}

export {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
  ensureLawyerProfileSkeleton,
} from "./lawyer-profile-learning.js";
