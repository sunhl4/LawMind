/**
 * Short utterance kinds shared by the intent compiler and the renderer-safe
 * turn-plan pruner. Keep this file free of capability catalogs and Node builtins.
 */

const CORRECTION_RE = /^(不对|不是这样|搞错了|错了|不是|别这样)[\s。.!！]*$/;

/**
 * 「不是合同审核，是看律师函」must not bind contract.review just because 合同 appears
 * in the negation. Keep this list phrase-level; do not strip every 不是.
 */
const REJECTED_CONTRACT_REVIEW_PHRASE_RE =
  /不是合同(?:审核|审查)|不要(?:做|再)?合同(?:审核|审查)|并非合同(?:审核|审查)|不是审查(?:这份|该)?合同|我要你做的不是合同(?:审核|审查)?/;

/** Remove negated 合同审核/审查 phrases before object-token matching. */
export function stripRejectedContractReviewPhrases(instruction: string): string {
  return instruction.replace(new RegExp(REJECTED_CONTRACT_REVIEW_PHRASE_RE.source, "g"), " ");
}

export function instructionRejectsContractReview(instruction: string): boolean {
  return REJECTED_CONTRACT_REVIEW_PHRASE_RE.test(instruction);
}

/** New task that must drop the previous 办件 checklist (not a short 「不对」). */
export function isTaskSwitchUtterance(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  if (instructionRejectsContractReview(t)) {
    return true;
  }
  return /我要你做的不是|不是这个(?:任务|办件|流程|工作)/.test(t);
}

export function isCorrectionUtterance(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  if (CORRECTION_RE.test(t)) {
    return true;
  }
  return t.length <= 12 && /^(不对|不是这样|搞错了|错了)/.test(t);
}

const LOOK_ONLY_RE =
  /^(帮我看看这份|帮我看看|帮我看一下|帮忙看一下|看看这份|看看这[个份]|看看|看一下|处理一下|整理一下|整理)[\s。.!！]*$/;

/**
 * Fuzzy look/process lines. Status bar may still hypothesize from files;
 * they must not lock a Skill dump or playbook pipeline.
 */
export function isLookOnlyUtterance(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  if (instructionRejectsContractReview(t) || isTaskSwitchUtterance(t) || isCorrectionUtterance(t)) {
    return false;
  }
  return LOOK_ONLY_RE.test(t);
}

const LETTER_OBJECT_RE = /律师函|催告函|通知函|回函/;
const LETTER_QA_CHECK_RE = /有误|核对|是否有误|是否正确|有没有错|对不对|核对我起草|看我起草/;

/** 已有函要核对对错，不是从零起草。排除合同审查本身不是函件 QA。 */
export function instructionLooksLikeLetterQa(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  return LETTER_OBJECT_RE.test(t) && LETTER_QA_CHECK_RE.test(t);
}

export function isSystemBracketMarker(name: string): boolean {
  return /^(交办|办件|邮件|用户在|用户将|从检查点继续)/.test(name) || /短路径|能力：/.test(name);
}

/** Lawyer-named folders in 【】, ignoring system chrome like 【交办】. */
export function namedBracketFolders(text: string): string[] {
  const out: string[] = [];
  const re = /【([^】]+)】/g;
  let m: RegExpExecArray | null = re.exec(text);
  while (m) {
    const name = m[1]?.trim() ?? "";
    if (name && name.length >= 4 && !isSystemBracketMarker(name)) {
      out.push(name);
    }
    m = re.exec(text);
  }
  return out;
}

export function instructionMentionsFolder(instruction: string): boolean {
  // Real folder language only. File-page 【用户将/用户在…】 chrome is not a folder.
  return /文件夹/.test(instruction);
}

/** 把材料收进案件，不是先通读再改稿。 */
export function instructionAsksToFileIntoMatter(instruction: string): boolean {
  return /收进|导入到|放进|归档到|拷进|复制进/.test(instruction);
}

/**
 * Read the materials before mutating. Mail short-path / Word 改稿 are not this.
 */
export function isReadFirstUtterance(instruction: string): boolean {
  return (
    isLookOnlyUtterance(instruction) ||
    instructionLooksLikeLetterQa(instruction) ||
    instructionMentionsFolder(instruction)
  );
}

const GREETING_RE =
  /^(你好|您好|在吗|嗨|哈喽|早上好|下午好|晚上好|hi|hello|hey|你是谁|你是什么模型|你叫什么)[\s?？。.!！]*$/i;

/** 纯确认/寒暄（常见中文 IM 简写，含 k / ok / 收到 / 1 / 表情）。 */
const BARE_ACK_RE =
  /^(k|ok|okay|好|好的|好滴|行|嗯|嗯嗯|可以|收到|知道了|了解了|明白|谢谢|多谢|辛苦了|1|11|👌|👍)[\s。.!！~～]*$/i;

export function isGreetingOnly(instruction: string): boolean {
  return GREETING_RE.test(instruction.trim());
}

export function isBareAckUtterance(instruction: string): boolean {
  const t = instruction.trim();
  return t.length > 0 && BARE_ACK_RE.test(t);
}

/**
 * 明确续作指令：只有这类原话才允许沿用上一轮清单继续办本件。
 *
 * 纯确认（好的 / 嗯 / 可以 / k / ok …）**不算**续作——它们是「无任务」，
 * 否则一句 `k` 会顺着上一轮的上下文把整条改稿流水线再跑一遍。
 */
const CONTINUE_RE =
  /^(继续|接着|再改一下|再改|导出|出稿|打开结果|加上.{0,20}|补充.{0,20}|同样|按这个)[\s。.!！]*$/;

export function isExplicitContinueUtterance(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return false;
  }
  if (isCorrectionUtterance(t) || isTaskSwitchUtterance(t)) {
    return false;
  }
  if (CONTINUE_RE.test(t)) {
    return true;
  }
  return t.length <= 16 && /^(继续|接着|再|导出|出稿|加上)/.test(t);
}

export function isContinuationUtterance(instruction: string): boolean {
  return isExplicitContinueUtterance(instruction);
}

/**
 * 本轮原话是否**不构成任务**：单字、纯确认，或空。
 *
 * Codex 对齐：没有新指令的回合不得据上一轮上下文（历史里的旧指令、
 * 在办本件、案件档案）重启起草 / 改稿 / 渲染 / 工作流。调用方据此收写工具。
 */
export function isNoTaskUtterance(instruction: string): boolean {
  const t = instruction.trim();
  if (!t) {
    return true;
  }
  if (isExplicitContinueUtterance(t)) {
    return false;
  }
  if (isCorrectionUtterance(t) || isTaskSwitchUtterance(t)) {
    return false;
  }
  return t.length < 2 || isBareAckUtterance(t);
}

/**
 * 文件夹或目录钉选不再要求先探查再写（铁律 5）。
 * 函数保留，调用方仍可记录「这轮提到了文件夹」，但不因此关写工具。
 */
export function shouldRequireFolderExplore(_input: {
  instruction: string;
  hasDirectoryPin?: boolean;
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  return false;
}
