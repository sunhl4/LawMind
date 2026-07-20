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
 *   6. 客户画像 CLIENT_PROFILE：优先 CASE 中 clientId → clients/<id>/；否则 clients/<matterId>/；再否则根目录 CLIENT_PROFILE.md
 *   7. memory/YYYY-MM-DD.md（今天 / 昨天）— 日志
 */

import fs from "node:fs/promises";
import path from "node:path";
import { caseFilePath, ensureCaseWorkspace, matterStrategyPath } from "./case-workspace.js";
import { writeMarkdownBulletToSection } from "./case-writes.js";
import { defaultClientProfileTemplate, defaultFirmProfileTemplate } from "./templates.js";

export { caseFilePath, ensureCaseWorkspace, matterStrategyPath } from "./case-workspace.js";

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
  /**
   * 客户画像：长期沟通风格、决策与付费习惯等（与单案事实区分）。
   * 解析顺序见 `loadMemoryContext` 文件头；未命中则为空串。
   */
  clientProfile: string;
  /**
   * 当画像来自 `clients/<id>/CLIENT_PROFILE.md` 时的 id（含与 matterId 相同时的目录约定）。
   * 根目录回退不设置，便于与「工作区级默认客户」区分。
   */
  clientProfileClientId?: string;
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

export function clausePlaybookPath(workspaceDir: string): string {
  return path.join(workspaceDir, "playbooks", "CLAUSE_PLAYBOOK.md");
}

export function courtAndOpponentProfilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "playbooks", "COURT_AND_OPPONENT_PROFILE.md");
}

export function clientProfileFilePath(workspaceDir: string, clientId: string): string {
  return path.join(workspaceDir, "clients", clientId, "CLIENT_PROFILE.md");
}

/**
 * 从案件档案中解析 `clientId`（供关联 `clients/<id>/CLIENT_PROFILE.md`）。
 * 支持「`- clientId: x` / `- 客户ID：x`」等常见写法；忽略占位与空值。
 */
export function extractClientIdFromCaseMarkdown(md: string): string | null {
  const lines = md.split(/\r?\n/).slice(0, 180);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const m1 = line.match(
      /^(?:[-*]\s*)?(?:\*\*)?\s*(clientId|client_id|客户\s*ID|客户ID)(?:\*\*)?\s*[:：]\s*(.+)$/i,
    );
    const m2 = m1 ? null : line.match(/^clientId\s*[:：]\s*(.+)$/i);
    const val = m1?.[2] ?? m2?.[1];
    if (!val) {
      continue;
    }
    const cleaned = val
      .replace(/^[`"'「」\s]+|[`"'」\s]+$/g, "")
      .replace(/^\s*\*+\s*|\s*\*+\s*$/g, "")
      .trim();
    if (!cleaned) {
      continue;
    }
    if (/^(可选|待填|tbd|n\/?a|_|同上|同左)$/i.test(cleaned)) {
      continue;
    }
    return cleaned;
  }
  return null;
}

// ─────────────────────────────────────────────
// 加载双记忆
// ─────────────────────────────────────────────

/**
 * 加载任务所需的记忆上下文。
 * 每次任务启动时调用一次，结果传入 Retrieval 和 Reasoning 层。
 * 2.0：同时加载 FIRM_PROFILE.md 和 MATTER_STRATEGY.md（若存在）。
 * 2.0+：客户画像 clientProfile — 有 matter 时按 CASE 中 clientId、否则 clients/与 matter 同 id/、再否则根目录，见文件头第 6 条。
 */
export async function loadMemoryContext(
  workspaceDir: string,
  opts: { matterId?: string } = {},
): Promise<MemoryContext> {
  const root = path.resolve(workspaceDir);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const matterId = opts.matterId?.trim();
  const caseMemoryPromise = matterId ? readSafe(caseFilePath(root, matterId)) : Promise.resolve("");
  const matterStrategyPromise = matterId
    ? readSafe(matterStrategyPath(root, matterId))
    : Promise.resolve("");

  const clientByMatterPromise = matterId
    ? readSafe(clientProfileFilePath(root, matterId))
    : Promise.resolve("");

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
    clientByMatter,
    rootClient,
  ] = await Promise.all([
    readSafe(path.join(root, "MEMORY.md")),
    readSafe(path.join(root, "LAWYER_PROFILE.md")),
    readSafe(path.join(root, "FIRM_PROFILE.md")),
    caseMemoryPromise,
    matterStrategyPromise,
    readSafe(dailyLogPath(root, today)),
    readSafe(dailyLogPath(root, yesterday)),
    readSafe(clausePlaybookPath(root)),
    readSafe(courtAndOpponentProfilePath(root)),
    clientByMatterPromise,
    readSafe(path.join(root, "CLIENT_PROFILE.md")),
  ]);

  let clientProfile = "";
  let clientProfileClientId: string | undefined = undefined;

  if (matterId) {
    const fromCase = extractClientIdFromCaseMarkdown(caseMemory);
    let scoped = "";
    let scopedId: string | undefined;
    if (fromCase) {
      const pathContent =
        fromCase === matterId
          ? clientByMatter
          : await readSafe(clientProfileFilePath(root, fromCase));
      if (pathContent.trim()) {
        scoped = pathContent;
        scopedId = fromCase;
      }
    }
    if (scoped) {
      clientProfile = scoped;
      clientProfileClientId = scopedId;
    } else if (clientByMatter.trim()) {
      clientProfile = clientByMatter;
      clientProfileClientId = matterId;
    } else if (rootClient.trim()) {
      clientProfile = rootClient;
    }
  } else if (rootClient.trim()) {
    clientProfile = rootClient;
  }

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
    clientProfile,
    clientProfileClientId,
  };
}

/**
 * 写入 CASE.md §1「案件名称（展示用）」；侧栏/列表优先显示此名称，不改变 matterId。
 */
export async function upsertMatterDisplayName(
  workspaceDir: string,
  matterId: string,
  displayName: string,
): Promise<void> {
  const { withCaseMdLock } = await import("./case-md-lock.js");
  await withCaseMdLock(workspaceDir, matterId, async () => {
    await ensureCaseWorkspace(workspaceDir, matterId);
    const filePath = caseFilePath(workspaceDir, matterId);
    let raw = await readSafe(filePath);
    const lineBody = `案件名称（展示用）: ${displayName.replace(/\n/g, " ").trim()}`;
    const line = `- ${lineBody}`;
    if (/\n- 案件名称（展示用）[:：][^\n]*/.test(raw)) {
      raw = raw.replace(/\n- 案件名称（展示用）[:：][^\n]*/g, `\n${line}`);
    } else if (/\n- matterId:[^\n]+/.test(raw)) {
      raw = raw.replace(/(\n- matterId:[^\n]+)/, `$1\n${line}`);
    } else {
      raw = writeMarkdownBulletToSection(raw, "## 1. 基本信息", lineBody, {
        mode: "append",
        timestamped: false,
      });
    }
    await fs.writeFile(filePath, raw, "utf8");
  });
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
  const filePath = clientProfileFilePath(workspaceDir, clientId);
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
  appendCaseArtifact,
  appendCaseCoreIssue,
  appendCaseProgress,
  appendCaseRiskNote,
  appendCaseSectionBullet,
  appendCaseTaskGoal,
  appendMatterStrategyDecision,
  type SectionWriteMode,
} from "./case-writes.js";
export {
  buildAgentMemorySourceReport,
  type BuildMemorySourceReportOpts,
  type EngineClientMemorySnapshot,
  type MemorySourceLayer,
  toEngineClientMemorySnapshot,
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
