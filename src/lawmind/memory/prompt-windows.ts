/**
 * Prompt 注入窗口：长记忆进模型前截断，避免 CASE/画像/日志无限膨胀拖垮 token。
 */

export const PROMPT_WINDOW = {
  /** 当前案件 CASE.md */
  matterContextChars: 8_000,
  /** LAWYER_PROFILE.md */
  lawyerProfileChars: 6_000,
  /** 客户画像 */
  clientProfileChars: 4_000,
  /** 今日 / 昨日工作日志 */
  dayLogChars: 3_000,
  /** 助手 PROFILE.md */
  assistantProfileChars: 3_000,
  /** 检索适配器单段记忆 */
  retrievalMemoryChars: 2_500,
  /** 相似案评分时最多读入的 CASE 字节（字符近似） */
  similarCaseReadChars: 64_000,
  /** CASE §8 工作进展保留条数（更早的归档到 progress-archive） */
  caseProgressMaxBullets: 80,
} as const;

export function truncateForPrompt(
  text: string | undefined | null,
  maxChars: number,
  label = "…[截断，完整内容见工作区文件]",
): string {
  const raw = (text ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= maxChars) {
    return raw;
  }
  const marker = `\n\n${label}\n\n`;
  const room = Math.max(16, maxChars - marker.length);
  const headBudget = Math.max(8, Math.floor(room * 0.65));
  const tailBudget = Math.max(8, room - headBudget);
  const head = raw.slice(0, headBudget).trimEnd();
  const tail = raw.slice(-tailBudget).trimStart();
  const out = `${head}${marker}${tail}`;
  return out.length <= maxChars ? out : out.slice(0, maxChars);
}

/**
 * CASE 进 prompt：优先保留前部结构化章节，进展区只留尾部。
 */
export function windowCaseMarkdownForPrompt(
  caseMemory: string | undefined | null,
  maxChars = PROMPT_WINDOW.matterContextChars,
): string {
  const raw = (caseMemory ?? "").trim();
  if (!raw) {
    return "";
  }
  const progressHeading = "## 8. 工作进展记录";
  const progressIdx = raw.indexOf(progressHeading);
  let candidate = raw;
  if (progressIdx >= 0) {
    const before = raw.slice(0, progressIdx).trimEnd();
    const afterStart = progressIdx + progressHeading.length;
    const rest = raw.slice(afterStart);
    const nextHeading = rest.search(/\n##\s+\d+\./);
    const progressBody = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
    const afterProgress = nextHeading >= 0 ? rest.slice(nextHeading) : "";
    const bulletLines = progressBody
      .split("\n")
      .map((l) => l.trimEnd())
      .filter(
        (l) => l.trim().startsWith("-") && !l.includes("已省略") && !l.includes("已轮转省略"),
      );
    const keep = 24;
    const keptBullets =
      bulletLines.length > keep
        ? [
            `- _（更早 ${bulletLines.length - keep} 条进展已省略，见 CASE.md §8 / progress-archive）_`,
            ...bulletLines.slice(-keep),
          ]
        : bulletLines;
    candidate =
      `${before}\n\n${progressHeading}\n\n${keptBullets.join("\n")}\n${afterProgress}`.trim();
  }
  if (candidate.length <= maxChars) {
    return candidate;
  }
  return truncateForPrompt(candidate, maxChars);
}
