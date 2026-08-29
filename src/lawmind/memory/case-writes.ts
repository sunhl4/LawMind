/**
 * CASE.md / MATTER_STRATEGY.md section writers.
 * Extracted from memory/index.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { withCaseMdLock } from "./case-md-lock.js";
import { ensureCaseWorkspace, matterStrategyPath } from "./case-workspace.js";

async function readSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function timestampLabel(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export type SectionWriteMode = "append" | "merge";

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

export function writeMarkdownBulletToSection(
  content: string,
  heading: string,
  bullet: string,
  opts: { mode: SectionWriteMode; timestamped: boolean; maxBullets?: number },
): string {
  const entry = opts.timestamped ? `- [${timestampLabel()}] ${bullet}` : `- ${bullet}`;
  const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
  const match = headingPattern.exec(content);

  if (!match || match.index < 0) {
    return trimMarkdownSectionBullets(
      `${content.trimEnd()}\n\n${heading}\n\n${entry}\n`,
      heading,
      opts.maxBullets,
    );
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

  let next: string;
  if (trimmedBody === "" || trimmedBody === "\n-" || trimmedBody === "\n- ") {
    next = `${content.slice(0, insertStart)}\n\n${entry}\n${content.slice(sectionEnd)}`;
  } else {
    next = `${content.slice(0, sectionEnd).trimEnd()}\n${entry}\n${content.slice(sectionEnd)}`;
  }
  return trimMarkdownSectionBullets(next, heading, opts.maxBullets);
}

/**
 * 将某章节 bullet 限制为最近 maxBullets 条；超额部分原样丢弃（调用方可先归档）。
 */
export function trimMarkdownSectionBullets(
  content: string,
  heading: string,
  maxBullets?: number,
): string {
  if (!maxBullets || maxBullets < 1) {
    return content;
  }
  const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
  const match = headingPattern.exec(content);
  if (!match || match.index < 0) {
    return content;
  }
  const insertStart = match.index + match[0].length;
  const afterHeading = content.slice(insertStart);
  const nextHeadingIndex = afterHeading.search(/\n##\s+\d+\./);
  const sectionEnd = nextHeadingIndex >= 0 ? insertStart + nextHeadingIndex + 1 : content.length;
  const sectionBody = content.slice(insertStart, sectionEnd);
  const lines = sectionBody.split("\n");
  const bulletIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim().startsWith("-")) {
      bulletIdxs.push(i);
    }
  }
  if (bulletIdxs.length <= maxBullets) {
    return content;
  }
  const drop = new Set(bulletIdxs.slice(0, bulletIdxs.length - maxBullets));
  const kept = lines.filter((_, i) => !drop.has(i));
  const note = `- _（更早 ${drop.size} 条已轮转省略；完整历史见 progress-archive.md）_`;
  const body = `\n\n${note}\n${kept.filter((l) => l.trim().startsWith("-")).join("\n")}\n`;
  return `${content.slice(0, insertStart)}${body}${content.slice(sectionEnd)}`;
}

/**
 * 向 MATTER_STRATEGY.md 的决策日志章节追加一条决策记录。
 */
export async function appendMatterStrategyDecision(
  workspaceDir: string,
  matterId: string,
  decision: string,
): Promise<void> {
  await ensureCaseWorkspace(workspaceDir, matterId);
  const filePath = matterStrategyPath(workspaceDir, matterId);
  const current = await readSafe(filePath);
  const next = writeMarkdownBulletToSection(current, "## 7. 决策日志", decision, {
    mode: "append",
    timestamped: true,
  });
  await fs.writeFile(filePath, next, "utf8");
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
  await withCaseMdLock(workspaceDir, matterId, async () => {
    const filePath = await ensureCaseWorkspace(workspaceDir, matterId);
    const current = await readSafe(filePath);
    const next = writeMarkdownBulletToSection(current, heading, bullet, {
      mode: opts.mode ?? "append",
      timestamped: opts.timestamped ?? true,
    });
    await fs.writeFile(filePath, next, "utf8");
  });
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
  await recordCaseAutoAdoption(workspaceDir, matterId, "case.task_goal", bullet);
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
  await recordCaseAutoAdoption(workspaceDir, matterId, "case.core_issue", bullet);
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
  await recordCaseAutoAdoption(workspaceDir, matterId, "case.risk_note", bullet);
}

export async function appendCaseProgress(
  workspaceDir: string,
  matterId: string,
  bullet: string,
): Promise<void> {
  const { PROMPT_WINDOW } = await import("./prompt-windows.js");
  await withCaseMdLock(workspaceDir, matterId, async () => {
    const filePath = await ensureCaseWorkspace(workspaceDir, matterId);
    const current = await readSafe(filePath);
    const heading = "## 8. 工作进展记录";
    // 轮转前把即将丢掉的旧 bullet 追加到归档（best-effort）
    await archiveOverflowProgressBullets(
      workspaceDir,
      matterId,
      current,
      heading,
      PROMPT_WINDOW.caseProgressMaxBullets,
    );
    const next = writeMarkdownBulletToSection(current, heading, bullet, {
      mode: "append",
      timestamped: true,
      maxBullets: PROMPT_WINDOW.caseProgressMaxBullets,
    });
    await fs.writeFile(filePath, next, "utf8");
  });
  await recordCaseAutoAdoption(workspaceDir, matterId, "case.progress", bullet);
}

async function archiveOverflowProgressBullets(
  workspaceDir: string,
  matterId: string,
  content: string,
  heading: string,
  maxBullets: number,
): Promise<void> {
  try {
    const headingPattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
    const match = headingPattern.exec(content);
    if (!match || match.index < 0) {
      return;
    }
    const insertStart = match.index + match[0].length;
    const afterHeading = content.slice(insertStart);
    const nextHeadingIndex = afterHeading.search(/\n##\s+\d+\./);
    const sectionEnd = nextHeadingIndex >= 0 ? insertStart + nextHeadingIndex + 1 : content.length;
    const sectionBody = content.slice(insertStart, sectionEnd);
    const bullets = sectionBody
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-") && !l.includes("已轮转省略"));
    // +1 for the bullet about to be appended
    if (bullets.length + 1 <= maxBullets) {
      return;
    }
    const overflow = bullets.slice(0, bullets.length + 1 - maxBullets);
    if (overflow.length === 0) {
      return;
    }
    const archivePath = path.join(workspaceDir, "cases", matterId, "progress-archive.md");
    const prev = await readSafe(archivePath);
    const chunk = overflow.join("\n");
    const next = prev.trim()
      ? `${prev.trimEnd()}\n${chunk}\n`
      : `# 工作进展归档（${matterId}）\n\n${chunk}\n`;
    await fs.writeFile(archivePath, next, "utf8");
  } catch {
    /* best-effort */
  }
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
  await recordCaseAutoAdoption(workspaceDir, matterId, "case.artifact", bullet);
}

/**
 * W5：把 case 自动写入也记入 MemoryAdoptionService（state=auto_adopted），
 * 便于 Inspector 显示历史 + 律师撤回。失败不阻塞 markdown 写入。
 */
async function recordCaseAutoAdoption(
  workspaceDir: string,
  matterId: string,
  kind: "case.task_goal" | "case.core_issue" | "case.risk_note" | "case.progress" | "case.artifact",
  bullet: string,
): Promise<void> {
  try {
    const { suggestMemoryAdoption } = await import("./adoption-service.js");
    await suggestMemoryAdoption(
      workspaceDir,
      path.join(workspaceDir, "audit"),
      {
        scope: "matter",
        kind,
        targetId: matterId,
        payload: bullet,
        origin: "engine",
      },
      { autoAdopt: true },
    );
  } catch {
    // best-effort
  }
}
