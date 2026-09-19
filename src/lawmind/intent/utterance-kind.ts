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

const CONTINUE_RE =
  /^(继续|接着|再改一下|再改|导出|出稿|打开结果|加上.{0,20}|补充.{0,20}|同样|按这个|好的|嗯|可以)[\s。.!！]*$/;

export function isContinuationUtterance(instruction: string): boolean {
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

/**
 * Folder talk / directory pin: the model must explore_folder this turn
 * before WRITE_HEAVY. Word 改稿 and mail short-path already have a file;
 * 「继续」must not re-block after that explore.
 */
export function shouldRequireFolderExplore(input: {
  instruction: string;
  hasDirectoryPin?: boolean;
  wordRevisionTurn?: boolean;
  mailContractTurn?: boolean;
}): boolean {
  if (input.wordRevisionTurn || input.mailContractTurn) {
    return false;
  }
  if (isContinuationUtterance(input.instruction)) {
    return false;
  }
  if (instructionAsksToFileIntoMatter(input.instruction)) {
    return false;
  }
  return instructionMentionsFolder(input.instruction) || Boolean(input.hasDirectoryPin);
}
