/**
 * Prompt 注入窗口：长记忆进模型前截断，避免 CASE/画像/日志无限膨胀拖垮 token。
 * 超帽必须带溢出指针（工具名 + 路径），禁止静默 slice。
 */

export type PromptOverflowHint = {
  tool: string;
  path: string;
};

export type TruncateForPromptOptions = {
  label?: string;
  overflow?: PromptOverflowHint;
};

export const PROMPT_WINDOW = {
  /** 当前案件 CASE.md（进展修剪上限；真正进 prompt 再用 matterIndexChars） */
  matterContextChars: 8_000,
  /** CASE 进模型的索引硬帽（正文用 read_case_file） */
  matterIndexChars: 1_600,
  /** `read_case_file` 默认分页（禁止一次返回全文） */
  caseFileReadChars: 4_000,
  /** LAWYER_PROFILE.md 全文窗（检索适配器用） */
  lawyerProfileChars: 6_000,
  /** 律师画像进模型的指纹硬帽 */
  lawyerFingerprintChars: 800,
  /** 客户画像 */
  clientProfileChars: 4_000,
  clientFingerprintChars: 800,
  /** 今日 / 昨日工作日志 */
  dayLogChars: 3_000,
  dayLogIndexChars: 600,
  /** 助手 PROFILE.md */
  assistantProfileChars: 3_000,
  assistantFingerprintChars: 800,
  /** 检索适配器单段记忆 */
  retrievalMemoryChars: 2_500,
  /** 相关记忆 gist（不再整文件 slice 进 system） */
  memoryHitGistChars: 180,
  /** 相似案评分时最多读入的 CASE 字节（字符近似） */
  similarCaseReadChars: 64_000,
  /** 相似案 / 金标准进 prompt 的摘录 */
  recallSnippetChars: 220,
  /** CASE §8 工作进展保留条数（更早的归档到 progress-archive） */
  caseProgressMaxBullets: 80,
} as const;

export type PromptWindowChars = {
  matterContextChars: number;
  matterIndexChars: number;
  caseFileReadChars: number;
  lawyerProfileChars: number;
  lawyerFingerprintChars: number;
  clientProfileChars: number;
  clientFingerprintChars: number;
  dayLogChars: number;
  dayLogIndexChars: number;
  assistantProfileChars: number;
  assistantFingerprintChars: number;
  retrievalMemoryChars: number;
  memoryHitGistChars: number;
  similarCaseReadChars: number;
  recallSnippetChars: number;
  caseProgressMaxBullets: number;
};

function overflowLabel(overflow: PromptOverflowHint): string {
  return `…[截断，完整内容请用 ${overflow.tool} 读取 ${overflow.path}]`;
}

/** Scale memory injection windows with model context (keeps floors, raises for large windows). */
export function scalePromptWindows(scale: number): PromptWindowChars {
  const s = Number.isFinite(scale) && scale > 0 ? Math.min(2.5, Math.max(0.5, scale)) : 1;
  const scaleChars = (n: number) => Math.max(n, Math.floor(n * s));
  return {
    matterContextChars: scaleChars(PROMPT_WINDOW.matterContextChars),
    matterIndexChars: scaleChars(PROMPT_WINDOW.matterIndexChars),
    caseFileReadChars: scaleChars(PROMPT_WINDOW.caseFileReadChars),
    lawyerProfileChars: scaleChars(PROMPT_WINDOW.lawyerProfileChars),
    lawyerFingerprintChars: scaleChars(PROMPT_WINDOW.lawyerFingerprintChars),
    clientProfileChars: scaleChars(PROMPT_WINDOW.clientProfileChars),
    clientFingerprintChars: scaleChars(PROMPT_WINDOW.clientFingerprintChars),
    dayLogChars: scaleChars(PROMPT_WINDOW.dayLogChars),
    dayLogIndexChars: scaleChars(PROMPT_WINDOW.dayLogIndexChars),
    assistantProfileChars: scaleChars(PROMPT_WINDOW.assistantProfileChars),
    assistantFingerprintChars: scaleChars(PROMPT_WINDOW.assistantFingerprintChars),
    retrievalMemoryChars: scaleChars(PROMPT_WINDOW.retrievalMemoryChars),
    memoryHitGistChars: scaleChars(PROMPT_WINDOW.memoryHitGistChars),
    similarCaseReadChars: scaleChars(PROMPT_WINDOW.similarCaseReadChars),
    recallSnippetChars: scaleChars(PROMPT_WINDOW.recallSnippetChars),
    caseProgressMaxBullets: Math.max(
      PROMPT_WINDOW.caseProgressMaxBullets,
      Math.floor(PROMPT_WINDOW.caseProgressMaxBullets * s),
    ),
  };
}

export function truncateForPrompt(
  text: string | undefined | null,
  maxChars: number,
  labelOrOpts?: string | TruncateForPromptOptions,
): string {
  const raw = (text ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= maxChars) {
    return raw;
  }
  const opts: TruncateForPromptOptions =
    typeof labelOrOpts === "string" ? { label: labelOrOpts } : (labelOrOpts ?? {});
  const label = opts.overflow
    ? overflowLabel(opts.overflow)
    : (opts.label ?? "…[截断，完整内容见工作区文件]");
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
  maxChars: number = PROMPT_WINDOW.matterContextChars,
  overflow?: PromptOverflowHint,
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
  return truncateForPrompt(candidate, maxChars, overflow ? { overflow } : undefined);
}
