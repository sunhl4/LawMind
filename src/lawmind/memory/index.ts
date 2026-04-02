/**
 * Memory Layer
 *
 * 负责在任务启动时加载双记忆文档，并提供写入接口。
 *
 * 读取顺序（固定）：
 *   1. MEMORY.md        — 通用长期记忆
 *   2. LAWYER_PROFILE.md — 律师个人偏好
 *   3. FIRM_PROFILE.md  — 律所级规则（Phase B）
 *   4. playbooks/CLAUSE_PLAYBOOK.md、playbooks/COURT_AND_OPPONENT_PROFILE.md（Phase B）
 *   5. cases/<matterId>/CASE.md、MATTER_STRATEGY.md — 案件按需
 *   6. memory/YYYY-MM-DD.md（今天 / 昨天）— 日志
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
  /** FIRM_PROFILE.md 内容（2.0：律所级规则与交付标准） */
  firmProfile: string;
  /** 案件级记忆（若指定 matterId） */
  caseMemory: string;
  /** cases/<matterId>/MATTER_STRATEGY.md（2.0：案件策略与决策记录） */
  matterStrategy: string;
  /** 今天的日志 */
  todayLog: string;
  /** 昨天的日志 */
  yesterdayLog: string;
  /** Phase B：playbooks/CLAUSE_PLAYBOOK.md */
  clausePlaybook: string;
  /** Phase B：playbooks/COURT_AND_OPPONENT_PROFILE.md */
  courtAndOpponentProfile: string;
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

export function matterStrategyPath(workspaceDir: string, matterId: string): string {
  return path.join(workspaceDir, "cases", matterId, "MATTER_STRATEGY.md");
}

export function clausePlaybookPath(workspaceDir: string): string {
  return path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md");
}

export function courtAndOpponentProfilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "playbooks", "COURT_AND_OPPONENT_PROFILE.md");
}

function defaultMatterStrategyTemplate(matterId: string): string {
  return `# 案件策略档案：${matterId}

## 1. 案件定性

- 案由分类：
- 当前阶段：_（例：谈判协商 / 诉前准备 / 一审 / 执行）_
- 预计周期：

---

## 2. 核心理论

- **胜诉路径**：_（简述主要法律依据和事实支撑）_
- **备选路径**：_（若主路径失利的替代方案）_
- **防守底线**：_（不可让步的最低目标）_

---

## 3. 关键节点

- 提交期限：
- 答辩期限：
- 庭审排期：
- 其他截止时间：

---

## 4. 证据与信息缺口

- 已有证据：
- 缺失证据：
- 待调查方向：

---

## 5. 对方分析

- 对方可能主张：
- 对方优势：
- 对方弱点：

---

## 6. 谈判策略（若适用）

- 理想解决方案：
- 可接受范围：
- 不可接受条件：

---

## 7. 决策日志

_此节记录本案的关键策略决定，由律师或 LawMind 审核后追加。_

- 
`;
}

function defaultFirmProfileTemplate(): string {
  return `# FIRM_PROFILE.md — 律所级规则与交付标准

本文件记录**律所层面**的规则、标准和限制。  
优先级高于律师个人偏好，低于客户特殊约定。  
**不要在此文件写入具体案件信息。**

---

## 一、律所基本信息

- **律所名称**：
- **主要业务领域**：
- **管辖地区**：

---

## 二、交付标准

- **内部文书格式**：_（例：Word 97-2003 格式、A4 页面、宋体/Times New Roman）_
- **外部文书格式**：_（例：有官方抬头、签字页规范）_
- **报价与费用**：_（例：不在任何对外文件中直接写明收费标准）_

---

## 三、对外口径规范

- **禁止表达**：_（例：不承诺任何诉讼结果、不使用"保证"表述）_
- **必要免责声明**：_（例：本意见仅供参考，不构成正式法律意见）_
- **涉及竞争对手**：_（例：不主动评论同行律所）_

---

## 四、风险红线

- 以下类型任务须在执行前请示合规或主任律师：
  - 
- 以下文书不得由 LawMind 直接渲染交付，须律师手动签署后发出：
  - 

---

## 五、利益冲突规则

- 冲突检查流程：
- 冲突数据库：

---

## 六、数据与保密规则

- 客户文件保密级别：
- 案件材料外发规则：
- LawMind 使用规范（哪些信息可输入 AI）：

---

_最后更新：（由律所合规/主任律师更新）_
`;
}

function defaultClientProfileTemplate(clientId: string): string {
  return `# CLIENT_PROFILE.md — 客户画像：${clientId}

本文件记录特定客户的沟通偏好、风险口径和业务背景。  
**不要在此文件写入案件具体事实或机密证据。**

---

## 一、客户基本信息

- **客户名称 / ID**：${clientId}
- **行业**：
- **主要联系人**：
- **决策层级**：

---

## 二、沟通风格

- **偏好报告格式**：_（例：三页以内摘要 + 完整附件）_
- **更新频率**：_（例：重大进展及时通报、每月书面进度报告）_
- **术语偏好**：_（例：非法律背景，避免过多专业术语）_

---

## 三、风险偏好

- **整体风险承受度**：_（例：保守 / 中性 / 激进）_
- **特别关注领域**：
- **绝对不可接受的风险**：

---

## 四、预算敏感度

- **费用关注程度**：
- **需要提前报价的阈值**：

---

## 五、历史合作记录

- **合作开始时间**：
- **主要案件类型**：
- **已知偏好与避雷点**：

---

_最后更新：（由负责律师更新）_
`;
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
 * 2.0：同时加载 FIRM_PROFILE.md 和 MATTER_STRATEGY.md（若存在）。
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
  const matterStrategyPromise = opts.matterId
    ? readSafe(matterStrategyPath(workspaceDir, opts.matterId))
    : "";

  const [
    general,
    profile,
    firmProfile,
    caseMemory,
    matterStrategy,
    todayLog,
    yesterdayLog,
    clausePlaybook,
    courtAndOpponentProfile,
  ] = await Promise.all([
    readSafe(path.join(workspaceDir, "MEMORY.md")),
    readSafe(path.join(workspaceDir, "LAWYER_PROFILE.md")),
    readSafe(path.join(workspaceDir, "FIRM_PROFILE.md")),
    caseMemoryPromise,
    matterStrategyPromise,
    readSafe(dailyLogPath(workspaceDir, today)),
    readSafe(dailyLogPath(workspaceDir, yesterday)),
    readSafe(clausePlaybookPath(workspaceDir)),
    readSafe(courtAndOpponentProfilePath(workspaceDir)),
  ]);

  return {
    general,
    profile,
    firmProfile,
    caseMemory,
    matterStrategy,
    todayLog,
    yesterdayLog,
    clausePlaybook,
    courtAndOpponentProfile,
  };
}

/**
 * 为指定案件初始化工作目录与 CASE.md。
 * 仅在缺失时创建，已有内容不覆盖。
 * 2.0：同时初始化 MATTER_STRATEGY.md。
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

  // 同时初始化 MATTER_STRATEGY.md（不覆盖现有内容）
  const strategyPath = matterStrategyPath(workspaceDir, matterId);
  const strategyExists = await fs
    .access(strategyPath)
    .then(() => true)
    .catch(() => false);
  if (!strategyExists) {
    await fs.writeFile(strategyPath, defaultMatterStrategyTemplate(matterId), "utf8");
  }

  return filePath;
}

/**
 * 确保 workspace 下存在 FIRM_PROFILE.md，不存在则用模板初始化。
 */
export async function ensureFirmProfile(workspaceDir: string): Promise<string> {
  const filePath = path.join(workspaceDir, "FIRM_PROFILE.md");
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.writeFile(filePath, defaultFirmProfileTemplate(), "utf8");
  }
  return filePath;
}

/**
 * 确保 clients/<clientId>/CLIENT_PROFILE.md 存在，不存在则用模板初始化。
 */
export async function ensureClientProfile(workspaceDir: string, clientId: string): Promise<string> {
  const filePath = path.join(workspaceDir, "clients", clientId, "CLIENT_PROFILE.md");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const exists = await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    await fs.writeFile(filePath, defaultClientProfileTemplate(clientId), "utf8");
  }
  return filePath;
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
  buildAgentMemorySourceReport,
  type BuildMemorySourceReportOpts,
  type MemorySourceLayer,
} from "./memory-sources.js";
export {
  appendLawyerProfileLearning,
  buildLawyerProfileReviewLearningLine,
  ensureLawyerProfileSkeleton,
} from "./lawyer-profile-learning.js";
export {
  appendClausePlaybookLearning,
  buildClausePlaybookReviewLine,
  CLAUSE_PLAYBOOK_RELATIVE,
  PLAYBOOK_REVIEW_SECTION,
  reviewLabelsTriggerPlaybook,
} from "./playbook-learning.js";
