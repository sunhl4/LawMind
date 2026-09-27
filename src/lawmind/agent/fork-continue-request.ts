/**
 * 律师在输入里要求「另起新对话并带上文」。
 *
 * 承前分叉（`session-carryover.ts`）原来只有两个入口：用量面板按钮、对话变长后的建议卡。
 * 模型工具表里没有这条动作。把原话送进当前回合，模型只能回答「无法替你新开对话」。
 * 回合还在跑时，Enter 走的是 steer（塞进下一轮采样，不开新会话），同样到不了 fork，
 * 而且 fork 会因 `turn_live` 拒绝。识别命中后由桌面执行 fork，不把这句话交给模型。
 */

export type ForkContinueRequest = {
  /** 去掉分叉指令后，还要在新会话里办的话。空字符串表示没有额外交办。 */
  remainder: string;
  /** 指令里有「继续 / 接着办」。没有额外交办时，新会话自动开一轮接着办。 */
  continueWork: boolean;
};

/** 只要求接着办、没有具体下一句时，发给新会话的交办。不得再命中本识别器。 */
export const FORK_CONTINUE_WORK_MESSAGE = "请按续接事实，继续办理上一段还没做完的事。";

const FORK_VERB_SOURCE =
  "(?:另起|重开|新开)(?:\\s*一个|\\s*一段)?(?:\\s*新(?:的)?)?(?:\\s*对话|\\s*会话)|开\\s*一个\\s*新\\s*(?:对话|会话)|换\\s*(?:一个\\s*)?新\\s*(?:对话|会话)";

const CONTENT_NEAR =
  /写|起草|说明|介绍|补充|加入|提到|称为|叫做|点击|按钮|面板|功能|文档|方案|手册|文案|标题|描述/;

const CONTINUE_WORK = /继续(?!使用|沿用|履行)|接着办|接着做|接着干|往下/;

function tailAsksToFork(tail: string): boolean {
  const head = tail.slice(0, 32);
  return /带上文|带上?上下文/.test(head) || CONTINUE_WORK.test(head);
}

function segmentIsForkCommand(segment: string): boolean {
  const match = new RegExp(FORK_VERB_SOURCE).exec(segment);
  if (!match || match.index == null) {
    return false;
  }
  const before = segment.slice(Math.max(0, match.index - 12), match.index);
  if (CONTENT_NEAR.test(before)) {
    return false;
  }
  const imperative = /(?:请|帮我|麻烦|给我|替我|现在|直接|你来|我要)/.test(before);
  // 整句就是这道指令（动词开头）。「双方同意另起新对话…」动词不在开头，也不带继续/带上文。
  const bare = match.index === 0 && segment.trim().length <= 48;
  return imperative || bare || tailAsksToFork(segment.slice(match.index + match[0].length));
}

function tidyRemainder(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^[，,、：:\s]+/, "").replace(/[，,、：:\s]+$/, "");
  text = text.replace(/^(?:另外|然后|并且|并|再|就|同时|我要|帮我|请|麻烦|因为|由于)\s*/, "");
  text = text.replace(
    /^(?:把|将)?(?:这场|这个|当前)?(?:对话|会话|上下文|内容)(?:太长了|太长|太多|过长|满了)?\s*/,
    "",
  );
  text = text.replace(/^(?:并?\s*)?带(?:上)?(?:上文|上下文)\s*/, "");
  text = text.replace(/^带上$/, "");
  text = text.replace(/^(?:继续|接着)(?:办|做|干|下去)?\s*/, "");
  return text
    .replace(/^[，,、：:\s]+/, "")
    .replace(/[，,、：:\s]+$/, "")
    .trim();
}

function stripForkClause(segment: string): string {
  const match = new RegExp(FORK_VERB_SOURCE).exec(segment);
  if (!match || match.index == null) {
    return segment;
  }
  const left = segment.slice(0, match.index);
  const right = segment.slice(match.index + match[0].length);
  const droppedLeft = /写|起草|说明|介绍|补充|方案|文档|手册/.test(left) ? left : "";
  const rest = `${droppedLeft} ${right}`
    .replace(/[（(]\s*带上文\s*[）)]/g, " ")
    .replace(/并?\s*带(?:上)?(?:上文|上下文)/g, " ");
  return tidyRemainder(rest);
}

/**
 * 命中则桌面应 fork，不要把原文送给模型。
 * 文稿里顺带提到这个功能（「写上另起新对话」）不算。
 */
export function parseForkContinueRequest(text: string): ForkContinueRequest | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 8_000) {
    return null;
  }
  const parts = trimmed
    .split(/[。！？\n；;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  let matched = false;
  let continueWork = false;
  const kept: string[] = [];
  for (const part of parts) {
    if (!segmentIsForkCommand(part)) {
      kept.push(part);
      continue;
    }
    matched = true;
    if (CONTINUE_WORK.test(part)) {
      continueWork = true;
    }
    const stripped = stripForkClause(part);
    if (stripped) {
      kept.push(stripped);
    }
  }
  if (!matched) {
    return null;
  }
  const remainder = tidyRemainder(kept.join("。"));
  return {
    remainder,
    continueWork,
  };
}
